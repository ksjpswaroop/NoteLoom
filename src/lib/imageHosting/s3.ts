import { Store } from "@tauri-apps/plugin-store";
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { toast } from '@/hooks/use-toast';
import { v4 as uuid } from 'uuid';
import type { S3Config } from './types';
import { buildObjectStorageUrl } from './object-storage-presets';

// AWS V4 ( Web Crypto API)
async function generateSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  payload: BufferSource,
  config: S3Config
) {
  const algorithm = 'AWS4-HMAC-SHA256';
  const date = new Date();
  const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = date.toISOString().replace(/[:\-]|\.\d{3}/g, '');
  
  // x-amz-date headers
  headers['x-amz-date'] = amzDate;
  
  //
  // URI ，
  const canonicalUri = new URL(url).pathname
    .split('/')
    .map((part) => encodeURIComponent(decodeURIComponent(part)))
    .join('/');
  const canonicalQuerystring = '';

  // AWS V4 Headers Key
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(key => `${key.toLowerCase()}:${headers[key].trim()}\n`)
    .join('');
    
  const signedHeaders = Object.keys(headers)
    .sort()
    .map(key => key.toLowerCase())
    .join(';');
  
  // Web Crypto API SHA256
  const payloadHash = await crypto.subtle.digest('SHA-256', payload);
  const payloadHashHex = Array.from(new Uint8Array(payloadHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHashHex
  ].join('\n');
  
  //
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');
  
  //
  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, config.region, 's3');
  const signature = await hmacSha256Hex(signingKey, stringToSign);
  
  return {
    authorization: `${algorithm} Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    payloadHashHex
  };
}

// Web Crypto API
async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key: CryptoKey, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return await crypto.subtle.sign('HMAC', key, encoder.encode(data));
}

async function hmacSha256Hex(key: CryptoKey, data: string): Promise<string> {
  const signature = await hmacSha256(key, data);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  
  //
  const kSecret = await crypto.subtle.importKey(
    'raw',
    encoder.encode('AWS4' + key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kDate = HMAC("AWS4" + kSecret, Date)
  const kDate = await crypto.subtle.sign('HMAC', kSecret, encoder.encode(dateStamp));
  const kDateKey = await crypto.subtle.importKey(
    'raw',
    kDate,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kRegion = HMAC(kDate, Region)
  const kRegion = await crypto.subtle.sign('HMAC', kDateKey, encoder.encode(regionName));
  const kRegionKey = await crypto.subtle.importKey(
    'raw',
    kRegion,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kService = HMAC(kRegion, Service)
  const kService = await crypto.subtle.sign('HMAC', kRegionKey, encoder.encode(serviceName));
  const kServiceKey = await crypto.subtle.importKey(
    'raw',
    kService,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kSigning = HMAC(kService, "aws4_request")
  const kSigning = await crypto.subtle.sign('HMAC', kServiceKey, encoder.encode('aws4_request'));
  return await crypto.subtle.importKey(
    'raw',
    kSigning,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

// S3
export async function testS3Connection(config: S3Config): Promise<boolean> {
  try {
    const store = await Store.load('store.json');
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    const url = buildObjectStorageUrl(config);
    

    const emptyPayload = new ArrayBuffer(0);
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload);
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    const headers: Record<string, string> = {
      'Host': new URL(url).host,
      'X-Amz-Content-Sha256': payloadHashHex
    };
    
    // GET HEAD， XML
    const method = 'GET';
    const { authorization, amzDate } = await generateSignature(method, url, headers, emptyPayload, config);
    
    const requestHeaders = new Headers();
    requestHeaders.append('Authorization', authorization);
    // ：fetch ，，
    requestHeaders.append('X-Amz-Date', amzDate);
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex);
    
    const response = await fetch(url, {
      method: method,
      headers: requestHeaders,
      proxy
    });

    if (response.status === 200) {
        return true;
    }

    // GET (ListObjects) （）， PUT
    if (response.status === 403) {
        console.warn('ListObjects (GET) failed with 403, trying PutObject to verify write permission...');
        
        const testKey = '.connection-test';
        const testUrl = buildObjectStorageUrl(config, testKey);
        const testContent = new TextEncoder().encode('test');
        
        const putHeaders = {
            'Host': new URL(testUrl).host,
            'Content-Type': 'text/plain',
            'Content-Length': testContent.byteLength.toString()
        };
        
        const { authorization: authPut, amzDate: datePut, payloadHashHex: hashPut } = 
            await generateSignature('PUT', testUrl, putHeaders, testContent, config);
            
        const requestPutHeaders = new Headers();
        requestPutHeaders.append('Authorization', authPut);
        requestPutHeaders.append('X-Amz-Date', datePut);
        requestPutHeaders.append('Content-Type', 'text/plain');
        requestPutHeaders.append('X-Amz-Content-Sha256', hashPut);
        
        const putResponse = await fetch(testUrl, {
            method: 'PUT',
            headers: requestPutHeaders,
            body: testContent,
            proxy
        });
        
        if (putResponse.status === 200 || putResponse.status === 204) {
            return true;
        } else {
             const putErrorText = await putResponse.text();
             console.error('PutObject also failed:', putResponse.status, putErrorText);
        }
    }

    const errorText = await response.text();
    console.warn('S3 Check Failed:', {
        status: response.status,
        statusText: response.statusText,
        url: url,
        headers: Object.fromEntries(response.headers.entries()),
        errorBody: errorText || '(empty body)'
    });
    
    return false;
  } catch (error) {
    console.error('S3 connection test failed:', error);
    
    //
    const errorMessage = (error as Error).message || String(error);
    if (errorMessage.includes('error sending request')) {
       console.warn('Network Error Details: Please check your Endpoint, Region, and Proxy settings. URL might be malformed.');
    }
    
    return false;
  }
}

// S3
export async function uploadImageByS3(file: File): Promise<string | undefined> {
  try {
    const store = await Store.load('store.json');
    const config = await store.get<S3Config>('s3Config');
    
    if (!config) {
      toast({
        title: 'S3 configuration error',
        description: 'Configure S3 settings first',
        variant: 'destructive',
      });
      return undefined;
    }
    
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    //
    const id = uuid();
    const ext = file.name.split('.').pop() || 'jpg';
    const filename = `${id}.${ext}`.replace(/\s/g, '_');
    
    // pathPrefix，
    const prefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : '';
    const key = prefix ? `${prefix}/${filename}` : filename;
    
    //
    const url = buildObjectStorageUrl(config, key);
    //
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    const headers = {
      'Host': new URL(url).host,
      'Content-Type': file.type || 'application/octet-stream',
      'Content-Length': file.size.toString()
    };
    
    const { authorization, amzDate, payloadHashHex } = await generateSignature('PUT', url, headers, arrayBuffer, config);
    
    const requestHeaders = new Headers();
    requestHeaders.append('Authorization', authorization);
    requestHeaders.append('X-Amz-Date', amzDate);
    requestHeaders.append('Content-Type', file.type || 'application/octet-stream');
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex);
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: requestHeaders,
      body: uint8Array,
      proxy
    });
    
    if (response.status === 200 || response.status === 204) {
      // URL
      if (config.customDomain) {
        const domain = config.customDomain.trim().replace(/\/+$/, '');
        return `${domain}/${key}`;
      } else {
        return buildObjectStorageUrl(config, key);
      }
    } else {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }
    
  } catch (error) {
    toast({
      title: 'Upload failed',
      description: (error as Error).message,
      variant: 'destructive',
    });
    return undefined;
  }
}
