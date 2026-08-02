import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { S3Config } from '@/types/sync'
import { buildRepoContentPath, debugSyncPath, debugSyncPerf } from './remote-file'

/**
 * S3 
 * OSS、AWS S3、MinIO S3 
 */

function getPerfNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function roundMs(value: number) {
  return Math.round(value)
}

// AWS V4 ( Web Crypto API)
async function generateSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  payload: BufferSource,
  config: S3Config
) {
  const algorithm = 'AWS4-HMAC-SHA256'
  const date = new Date()
  const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, '')
  const amzDate = date.toISOString().replace(/[:\-]|\.\d{3}/g, '')

  // x-amz-date headers
  headers['x-amz-date'] = amzDate

  //
  // URI ，
  const urlObj = new URL(url)
  const canonicalUri = urlObj.pathname

  // AWS V4
  const canonicalQuerystring = Array.from(urlObj.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')

  // AWS V4 Headers Key
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(key => `${key.toLowerCase()}:${headers[key].trim()}\n`)
    .join('')

  const signedHeaders = Object.keys(headers)
    .sort()
    .map(key => key.toLowerCase())
    .join(';')

  // Web Crypto API SHA256
  const payloadHash = await crypto.subtle.digest('SHA-256', payload)
  const payloadHashHex = Array.from(new Uint8Array(payloadHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHashHex
  ].join('\n')

  //
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n')

  //
  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, config.region, 's3')
  const signature = await hmacSha256Hex(signingKey, stringToSign)

  return {
    authorization: `${algorithm} Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    payloadHashHex
  }
}

// Web Crypto API
async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder()
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data))
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmacSha256(key: CryptoKey, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  return await crypto.subtle.sign('HMAC', key, encoder.encode(data))
}

async function hmacSha256Hex(key: CryptoKey, data: string): Promise<string> {
  const signature = await hmacSha256(key, data)
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Promise<CryptoKey> {
  const encoder = new TextEncoder()

  //
  const kSecret = await crypto.subtle.importKey(
    'raw',
    encoder.encode('AWS4' + key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // kDate = HMAC("AWS4" + kSecret, Date)
  const kDate = await crypto.subtle.sign('HMAC', kSecret, encoder.encode(dateStamp))

  const kDateKey = await crypto.subtle.importKey(
    'raw',
    kDate,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // kRegion = HMAC(kDate, Region)
  const kRegion = await crypto.subtle.sign('HMAC', kDateKey, encoder.encode(regionName))
  const kRegionKey = await crypto.subtle.importKey(
    'raw',
    kRegion,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // kService = HMAC(kRegion, Service)
  const kService = await crypto.subtle.sign('HMAC', kRegionKey, encoder.encode(serviceName))
  const kServiceKey = await crypto.subtle.importKey(
    'raw',
    kService,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // kSigning = HMAC(kService, "aws4_request")
  const kSigning = await crypto.subtle.sign('HMAC', kServiceKey, encoder.encode('aws4_request'))
  return await crypto.subtle.importKey(
    'raw',
    kSigning,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

/**
 * S3 URL
 * Virtual Hosted Style Path Style
 */
function buildS3Url(config: S3Config, key: string): string {
  const endpoint = (config.endpoint || `https://s3.${config.region}.amazonaws.com`).trim()
  const bucket = config.bucket.trim()

  // endpoint
  const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint

  // pathPrefix，
  const prefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
  const fullKey = prefix ? `${prefix}/${key}` : key
  const encodedFullKey = buildRepoContentPath({ path: fullKey })
  debugSyncPath('s3.buildUrl', {
    key,
    pathPrefix: prefix,
    fullKey,
    encodedFullKey,
  })

  let url = ''

  // OSS、AWS S3 Virtual Hosted Style
  const isAliyun = cleanEndpoint.includes('aliyuncs.com')
  const isAWS = cleanEndpoint.includes('amazonaws.com')
  const isCloudflareR2 = cleanEndpoint.includes('cloudflarestorage.com')

  // Cloudflare R2 Path Style， Virtual Hosted Style
  if (isCloudflareR2) {
    // Path Style: https://endpoint/bucket/key
    url = `${cleanEndpoint}/${bucket}/${encodedFullKey}`
  } else if (isAliyun || isAWS) {
    // Virtual Hosted Style: https://bucket.endpoint/key
    try {
      const urlObj = new URL(cleanEndpoint)
      urlObj.hostname = `${bucket}.${urlObj.hostname}`
      url = `${urlObj.toString()}/${encodedFullKey}`
      //
      url = url.replace(/([^:]\/)\/+/g, '$1')
    } catch {
      console.warn('[S3 Sync] Failed to switch to Virtual Hosted Style, using Path Style')
      url = `${cleanEndpoint}/${bucket}/${encodedFullKey}`
    }
  } else {
    // MinIO Path Style
    url = `${cleanEndpoint}/${bucket}/${encodedFullKey}`
  }

  return url
}

/**
 * S3 URL（ key）
 */
function buildS3BaseUrl(config: S3Config): string {
  const endpoint = (config.endpoint || `https://s3.${config.region}.amazonaws.com`).trim()
  const bucket = config.bucket.trim()

  // endpoint
  const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint

  // OSS、AWS S3 Virtual Hosted Style
  const isAliyun = cleanEndpoint.includes('aliyuncs.com')
  const isAWS = cleanEndpoint.includes('amazonaws.com')

  if (isAliyun || isAWS) {
    try {
      const urlObj = new URL(cleanEndpoint)
      urlObj.hostname = `${bucket}.${urlObj.hostname}`
      return urlObj.toString().replace(/\/+$/, '')
    } catch {
      console.warn('[S3 Sync] Failed to switch to Virtual Hosted Style, using Path Style')
      return `${cleanEndpoint}/${bucket}`
    }
  }

  return `${cleanEndpoint}/${bucket}`
}

/**
 * S3 
 */
export async function testS3Connection(config: S3Config, proxy?: Proxy): Promise<boolean> {
  try {
    const baseUrl = buildS3BaseUrl(config)

    const emptyPayload = new ArrayBuffer(0)
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload)
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const headers: Record<string, string> = {
      Host: new URL(baseUrl).host,
      'X-Amz-Content-Sha256': payloadHashHex
    }

    // GET HEAD， XML
    const method = 'GET'
    const { authorization, amzDate } = await generateSignature(method, baseUrl, headers, emptyPayload, config)

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(baseUrl, {
      method: method,
      headers: requestHeaders,
      proxy
    })

    if (response.status === 200) {
      return true
    }

    // GET (ListObjects) （）， PUT
    if (response.status === 403) {
      console.warn('ListObjects (GET) failed with 403, trying PutObject to verify write permission...')

      const testKey = '.connection-test'
      const testUrl = buildS3Url(config, testKey)
      const testContent = new TextEncoder().encode('test')

      const putHeaders = {
        Host: new URL(testUrl).host,
        'Content-Type': 'text/plain',
        'Content-Length': testContent.byteLength.toString()
      }

      const { authorization: authPut, amzDate: datePut, payloadHashHex: hashPut } =
        await generateSignature('PUT', testUrl, putHeaders, testContent, config)

      const requestPutHeaders = new Headers()
      requestPutHeaders.append('Authorization', authPut)
      requestPutHeaders.append('X-Amz-Date', datePut)
      requestPutHeaders.append('Content-Type', 'text/plain')
      requestPutHeaders.append('X-Amz-Content-Sha256', hashPut)

      const putResponse = await fetch(testUrl, {
        method: 'PUT',
        headers: requestPutHeaders,
        body: testContent,
        proxy
      })

      if (putResponse.status === 200 || putResponse.status === 204) {
        //
        try {
          const deleteHeaders = {
            Host: new URL(testUrl).host
          }
          const { authorization: authDel, amzDate: dateDel, payloadHashHex: hashDel } =
            await generateSignature('DELETE', testUrl, deleteHeaders, emptyPayload, config)

          const requestDelHeaders = new Headers()
          requestDelHeaders.append('Authorization', authDel)
          requestDelHeaders.append('X-Amz-Date', dateDel)
          requestDelHeaders.append('X-Amz-Content-Sha256', hashDel)

          await fetch(testUrl, {
            method: 'DELETE',
            headers: requestDelHeaders,
            proxy
          })
        } catch {
          //
        }
        return true
      } else {
        const putErrorText = await putResponse.text()
        console.error('PutObject also failed:', putResponse.status, putErrorText)
      }
    }

    const errorText = await response.text()
    console.warn('S3 Check Failed:', {
      status: response.status,
      statusText: response.statusText,
      url: baseUrl,
      headers: Object.fromEntries(response.headers.entries()),
      errorBody: errorText || '(empty body)'
    })

    return false
  } catch (error) {
    console.error('S3 connection test failed:', error)

    //
    const errorMessage = (error as Error).message || String(error)
    if (errorMessage.includes('error sending request')) {
      console.warn(
        'Network Error Details: Please check your Endpoint, Region, and Proxy settings. URL might be malformed.'
      )
    }

    return false
  }
}

/**
 * S3（）
 */
export async function s3Upload(
  config: S3Config,
  key: string,
  content: string | Uint8Array,
  proxy?: Proxy,
  contentType = 'text/markdown; charset=utf-8'
): Promise<{ etag: string } | null> {
  const uploadStartedAt = getPerfNow()
  let previousPerfAt = uploadStartedAt
  const logPerf = (step: string, payload: Record<string, unknown> = {}) => {
    const now = getPerfNow()
    debugSyncPerf(`s3.upload.${step}`, {
      key,
      stepMs: roundMs(now - previousPerfAt),
      totalMs: roundMs(now - uploadStartedAt),
      ...payload,
    })
    previousPerfAt = now
  }

  try {
    logPerf('start', {
      contentLength: content.length,
      hasPathPrefix: Boolean(config.pathPrefix),
    })
    const url = buildS3Url(config, key)
    const contentBytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    logPerf('encodeContent', {
      byteLength: contentBytes.byteLength,
    })

    const headers = {
      Host: new URL(url).host,
      'Content-Type': contentType,
      'Content-Length': contentBytes.byteLength.toString()
    }

    const { authorization, amzDate, payloadHashHex } = await generateSignature(
      'PUT',
      url,
      headers,
      contentBytes,
      config
    )
    logPerf('generateSignature')

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('Content-Type', contentType)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(url, {
      method: 'PUT',
      headers: requestHeaders,
      body: contentBytes,
      proxy
    })
    logPerf('putRequest', {
      status: response.status,
    })

    if (response.status === 200 || response.status === 204) {
      // ETag
      const etag = response.headers.get('ETag') || ''
      logPerf('completed', {
        success: true,
        status: response.status,
        hasEtag: Boolean(etag),
      })
      return { etag }
    } else {
      const errorText = await response.text()
      logPerf('completed', {
        success: false,
        status: response.status,
        bodyLength: errorText.length,
      })
      console.error('S3 Upload failed:', response.status, errorText)
      return null
    }
  } catch (error) {
    logPerf('failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('S3 Upload error:', error)
    return null
  }
}

/**
 * S3 （）
 */
async function s3DownloadBytesInternal(
  config: S3Config,
  key: string,
  proxy?: Proxy
): Promise<{ content: Uint8Array; etag: string; lastModified: string } | null> {
  const startedAt = getPerfNow()
  let previousPerfAt = startedAt
  const logPerf = (step: string, payload: Record<string, unknown> = {}) => {
    const now = getPerfNow()
    debugSyncPerf(`s3.download.${step}`, {
      key,
      stepMs: roundMs(now - previousPerfAt),
      totalMs: roundMs(now - startedAt),
      ...payload,
    })
    previousPerfAt = now
  }

  try {
    logPerf('start')
    const url = buildS3Url(config, key)

    const emptyPayload = new ArrayBuffer(0)
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload)
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const headers: Record<string, string> = {
      Host: new URL(url).host,
      'X-Amz-Content-Sha256': payloadHashHex
    }

    const { authorization, amzDate } = await generateSignature('GET', url, headers, emptyPayload, config)
    logPerf('generateSignature')

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(url, {
      method: 'GET',
      headers: requestHeaders,
      proxy
    })
    logPerf('getRequest', {
      status: response.status,
    })

    if (response.status === 200) {
      const content = new Uint8Array(await response.arrayBuffer())
      const etag = response.headers.get('ETag') || ''
      const lastModified = response.headers.get('Last-Modified') || ''
      logPerf('readBody', {
        contentLength: content.length,
      })

      return { content, etag, lastModified }
    } else if (response.status === 404) {
      //
      logPerf('completed', {
        success: false,
        status: response.status,
      })
      return null
    } else {
      const errorText = await response.text()
      logPerf('completed', {
        success: false,
        status: response.status,
        bodyLength: errorText.length,
      })
      console.error('S3 Download failed:', response.status, errorText)
      return null
    }
  } catch (error) {
    logPerf('failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('S3 Download error:', error)
    return null
  }
}

export async function s3DownloadBytes(
  config: S3Config,
  key: string,
  proxy?: Proxy
): Promise<{ content: Uint8Array; etag: string; lastModified: string } | null> {
  return await s3DownloadBytesInternal(config, key, proxy)
}

export async function s3Download(
  config: S3Config,
  key: string,
  proxy?: Proxy
): Promise<{ content: string; etag: string; lastModified: string } | null> {
  const file = await s3DownloadBytesInternal(config, key, proxy)
  return file ? { ...file, content: new TextDecoder().decode(file.content) } : null
}

/**
 * S3 
 */
export async function s3Delete(config: S3Config, key: string, proxy?: Proxy): Promise<boolean> {
  try {
    const url = buildS3Url(config, key)

    const emptyPayload = new ArrayBuffer(0)
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload)
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const headers: Record<string, string> = {
      Host: new URL(url).host,
      'X-Amz-Content-Sha256': payloadHashHex
    }

    const { authorization, amzDate } = await generateSignature('DELETE', url, headers, emptyPayload, config)

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(url, {
      method: 'DELETE',
      headers: requestHeaders,
      proxy
    })

    // 204 No Content 200 OK
    return response.status === 204 || response.status === 200
  } catch (error) {
    console.error('S3 Delete error:', error)
    return false
  }
}

/**
 * S3 （）
 */
export async function s3ListObjects(
  config: S3Config,
  prefix: string,
  proxy?: Proxy
): Promise<Array<{ key: string; etag: string; lastModified: string; size: number }>> {
  const startedAt = getPerfNow()
  let previousPerfAt = startedAt
  const logPerf = (step: string, payload: Record<string, unknown> = {}) => {
    const now = getPerfNow()
    debugSyncPerf(`s3.listObjects.${step}`, {
      prefix,
      stepMs: roundMs(now - previousPerfAt),
      totalMs: roundMs(now - startedAt),
      ...payload,
    })
    previousPerfAt = now
  }

  try {
    logPerf('start')
    const baseUrl = buildS3BaseUrl(config)

    // pathPrefix
    const configPrefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
    const fullPrefix = configPrefix ? `${configPrefix}/${prefix}` : prefix

    // ListObjectsV2 URL
    const listUrl = new URL(baseUrl)
    listUrl.searchParams.set('list-type', '2')
    listUrl.searchParams.set('prefix', fullPrefix)

    const urlStr = listUrl.toString()

    const emptyPayload = new ArrayBuffer(0)
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload)
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const headers: Record<string, string> = {
      Host: new URL(urlStr).host,
      'X-Amz-Content-Sha256': payloadHashHex
    }

    const { authorization, amzDate } = await generateSignature('GET', urlStr, headers, emptyPayload, config)
    logPerf('generateSignature')

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(urlStr, {
      method: 'GET',
      headers: requestHeaders,
      proxy
    })
    logPerf('getRequest', {
      status: response.status,
    })

    if (response.status === 200) {
      const xmlText = await response.text()
      const result = parseListObjectsResponse(xmlText, configPrefix)
      logPerf('parseResponse', {
        responseLength: xmlText.length,
        resultCount: result.length,
      })
      return result
    } else {
      const errorText = await response.text()
      logPerf('completed', {
        success: false,
        status: response.status,
        bodyLength: errorText.length,
      })
      console.error('S3 ListObjects failed:', response.status, errorText)
      return []
    }
  } catch (error) {
    logPerf('failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('S3 ListObjects error:', error)
    return []
  }
}

/**
 * ListObjectsV2 XML
 */
function parseListObjectsResponse(
  xml: string,
  prefix: string
): Array<{ key: string; etag: string; lastModified: string; size: number }> {
  const results: Array<{ key: string; etag: string; lastModified: string; size: number }> = []

  // Contents
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g
  let match

  while ((match = contentsRegex.exec(xml)) !== null) {
    const content = match[1]

    // Key
    const keyMatch = /<Key>(.*?)<\/Key>/.exec(content)
    // ETag
    const etagMatch = /<ETag>(.*?)<\/ETag>/.exec(content)
    // LastModified
    const lastModifiedMatch = /<LastModified>(.*?)<\/LastModified>/.exec(content)
    // Size
    const sizeMatch = /<Size>(.*?)<\/Size>/.exec(content)

    if (keyMatch) {
      let key = keyMatch[1]

      // prefix ，
      if (prefix && key.startsWith(prefix + '/')) {
        key = key.substring(prefix.length + 1)
      }

      results.push({
        key,
        etag: etagMatch ? etagMatch[1].replace(/"/g, '') : '',
        lastModified: lastModifiedMatch ? lastModifiedMatch[1] : '',
        size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0
      })
    }
  }

  return results
}

/**
 * 
 */
export async function s3HeadObject(
  config: S3Config,
  key: string,
  proxy?: Proxy
): Promise<{ etag: string; lastModified: string } | null> {
  const startedAt = getPerfNow()
  let previousPerfAt = startedAt
  const logPerf = (step: string, payload: Record<string, unknown> = {}) => {
    const now = getPerfNow()
    debugSyncPerf(`s3.headObject.${step}`, {
      key,
      stepMs: roundMs(now - previousPerfAt),
      totalMs: roundMs(now - startedAt),
      ...payload,
    })
    previousPerfAt = now
  }

  try {
    logPerf('start')
    const url = buildS3Url(config, key)

    const emptyPayload = new ArrayBuffer(0)
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload)
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const headers: Record<string, string> = {
      Host: new URL(url).host,
      'X-Amz-Content-Sha256': payloadHashHex
    }

    const { authorization, amzDate } = await generateSignature('HEAD', url, headers, emptyPayload, config)
    logPerf('generateSignature')

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(url, {
      method: 'HEAD',
      headers: requestHeaders,
      proxy
    })
    logPerf('headRequest', {
      status: response.status,
    })

    if (response.status === 200) {
      const etag = response.headers.get('ETag') || ''
      const lastModified = response.headers.get('Last-Modified') || ''

      return { etag, lastModified }
    } else if (response.status === 404) {
      //
      logPerf('completed', {
        success: false,
        status: response.status,
      })
      return null
    } else {
      const errorText = await response.text()
      logPerf('completed', {
        success: false,
        status: response.status,
        bodyLength: errorText.length,
      })
      console.error('S3 HeadObject failed:', response.status, errorText)
      return null
    }
  } catch (error) {
    logPerf('failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('S3 HeadObject error:', error)
    return null
  }
}
