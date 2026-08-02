import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { buildRepoContentPath, buildRepoContentsEndpoint, debugSyncPath, encodeRemoteFileContent, pickNestedFileEntry } from './remote-file'
export { decodeBase64ToString } from './remote-file'
// Remove unused imports - these types are not actually used in this file

// ， GitHub
type GiteeResponse<T> = {
  data: T;
  status?: number;
  headers?: Record<string, string>;
}

// File Base64
export async function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      //
      const base64 = reader.result?.toString().replace(/^data:image\/\w+;base64,/, '');
      resolve(base64 || '');
    }
    reader.onerror = error => reject(error);
  });
}

// Gitee Error ， GitHub
export interface GiteeError {
  status: number;
  message: string;
}

// Gitee
export interface GiteeRepoInfo {
  id: number;
  full_name: string;
  human_name: string;
  url: string;
  namespace: {
    id: number;
    name: string;
    path: string;
  };
  path: string;
  name: string;
  owner: {
    id: number;
    login: string;
    name: string;
    avatar_url: string;
    url: string;
    html_url: string;
    remark: string;
    followers_url: string;
    following_url: string;
    gists_url: string;
    starred_url: string;
    subscriptions_url: string;
    organizations_url: string;
    repos_url: string;
    events_url: string;
    received_events_url: string;
    type: string;
  };
  private: boolean;
  html_url: string;
  description: string;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  homepage: string;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  language: string;
  default_branch: string;
  open_issues_count: number;
  license: {
    key: string;
    name: string;
    spdx_id: string;
    url: string;
  } | null;
  topics: string[];
  has_issues: boolean;
  has_wiki: boolean;
  has_pages: boolean;
  issue_comment: boolean;
  can_comment: boolean;
  repository_type: string;
  permissions: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export interface GiteeFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  download_url: string;
  type: string;
  _links: Links;
  isNew?: boolean;
}

interface Links {
  self: string;
  html: string;
}

type GiteeDirectoryFileEntry = Partial<GiteeFile> & {
  content?: string
  url?: string
  download_url?: string | null
}
type GiteeDirectoryListingResult = GiteeDirectoryFileEntry[] & GiteeDirectoryFileEntry
type GiteeGetFilesResult = GiteeDirectoryFileEntry | GiteeDirectoryListingResult | null | undefined

function looksLikeFilePath(path?: string) {
  const lastSegment = path?.split('/').filter(Boolean).pop() || ''
  return lastSegment.includes('.')
}

function appendAccessToken(url: string, accessToken: string) {
  try {
    const parsedUrl = new URL(url)
    if (!parsedUrl.searchParams.has('access_token')) {
      parsedUrl.searchParams.set('access_token', accessToken)
    }
    return parsedUrl.toString()
  } catch {
    return url
  }
}

async function resolveDirectoryFileEntryContent(
  entry: GiteeDirectoryFileEntry,
  accessToken: string,
  proxy?: Proxy
) {
  if (typeof entry.content === 'string') {
    return entry
  }

  const requestOptions = {
    method: 'GET',
    proxy,
  }

  if (entry.url) {
    const response = await fetch(appendAccessToken(entry.url, accessToken), requestOptions)
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GiteeDirectoryFileEntry
      if (typeof data.content === 'string') {
        return data
      }
    }
  }

  if (entry.download_url) {
    const response = await fetch(appendAccessToken(entry.download_url, accessToken), requestOptions)
    if (response.status >= 200 && response.status < 300) {
      const content = await response.text()
      return {
        ...entry,
        content: Buffer.from(content, 'utf-8').toString('base64'),
      }
    }
  }

  return null
}

export async function uploadFile(
  { file, filename, sha, message, repo, path }:
  { file: string | Uint8Array, filename?: string, sha?: string, message?: string, repo: string, path?: string })
{
  const store = await Store.load('store.json');
  const accessToken = await store.get('giteeAccessToken')
  const giteeUsername = await store.get('giteeUsername')
  const id = uuid()
  
  //
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    let targetPath = path
    let resolvedExistingFile: GiteeDirectoryFileEntry | null = null
    if (path) {
      const existingFile = await getFiles({ path, repo })
      if (existingFile && !Array.isArray(existingFile)) {
        resolvedExistingFile = existingFile
        targetPath = existingFile.path || path
        sha = existingFile.sha || sha
      }
    }

    const finalPath = resolvedExistingFile
      ? buildRepoContentPath({ path: targetPath })
      : targetPath
      ? buildRepoContentPath({ path: targetPath, filename })
      : buildRepoContentPath({ filename: filename || id })
    debugSyncPath('gitee.uploadFile', {
      inputPath: path,
      filename,
      resolvedExistingPath: resolvedExistingFile?.path,
      finalPath,
      hasSha: Boolean(sha),
    })

    // Base64（Gitee API ）
    const base64Content = encodeRemoteFileContent(file)

    //
    const headers = new Headers();
    headers.append('Content-Type', 'application/json');

    // sha（POST）（PUT）
    // Gitee API GitHub ， PUT
    const requestOptions = {
      method: sha ? 'PUT' : 'POST',
      headers,
      body: JSON.stringify({
        access_token: accessToken,
        content: base64Content,
        message: message || `Upload ${filename || id}`,
        branch: 'master',
        sha
      }),
      proxy
    };

    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}${buildRepoContentsEndpoint(finalPath)}`;
    const response = await fetch(url, requestOptions);

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return { data } as GiteeResponse<any>;
    }

    if (response.status === 400) {
      return null;
    }

    // 404 ， POST
    if (response.status === 404) {
      const postOptions = {
        method: 'POST',
        headers,
        body: JSON.stringify({
          access_token: accessToken,
          content: base64Content,
          message: message || `Upload ${filename || id}`,
          branch: 'master',
        }),
        proxy
      };
      const postResponse = await fetch(url, postOptions);
      if (postResponse.status >= 200 && postResponse.status < 300) {
        const data = await postResponse.json();
        return { data } as GiteeResponse<any>;
      }
      const postErrorData = await postResponse.json();
      throw {
        status: postResponse.status,
        message: postErrorData.message || 'Sync failed'
      };
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Sync failed'
    };
  } catch (error) {
    toast({
      title: 'Sync failed',
      description: (error as GiteeError).message,
      variant: 'destructive',
    })
  }
}

export async function getFiles({ path, repo, ref }: { path: string, repo: string, ref?: string }): Promise<GiteeGetFilesResult> {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteeAccessToken')
  if (!accessToken) return;

  const giteeUsername = await store.get<string>('giteeUsername')
  const normalizedPath = buildRepoContentPath({ path })
  debugSyncPath('gitee.getFiles', {
    inputPath: path,
    normalizedPath,
  })

  //
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined

  try {
    // URL
    let urlParams = `access_token=${accessToken}`
    if (ref) {
      urlParams += `&ref=${ref}`
    }

    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}${buildRepoContentsEndpoint(normalizedPath)}?${urlParams}`;
    
    const requestOptions = {
      method: 'GET',
      proxy
    };
    
    try {
      const response = await fetch(url, requestOptions);
      if (response.status >= 200 && response.status < 300) {
        const data = await response.json() as GiteeGetFilesResult;
        if (Array.isArray(data) && looksLikeFilePath(path)) {
          const nestedFile = pickNestedFileEntry(data, path)
          if (nestedFile) {
            if (nestedFile.path && nestedFile.path !== path) {
              const resolvedFile = await getFiles({ path: nestedFile.path, repo, ref })
              if (resolvedFile && !Array.isArray(resolvedFile)) {
                return resolvedFile
              }
            }

            const resolvedEntry = await resolveDirectoryFileEntryContent(
              nestedFile as GiteeDirectoryFileEntry,
              accessToken,
              proxy
            )
            if (resolvedEntry) {
              return resolvedEntry
            }
          }

          debugSyncPath('gitee.getFiles.fileNotFoundFromListing', {
            inputPath: path,
            normalizedPath,
            listingCount: data.length,
          })
          return null
        }
        return data;
      }
      return null;
    } catch {
      return null;
    }
  } catch (error) {
    if ((error as GiteeError).status !== 404) {
      toast({
        title: 'Query failed',
        description: (error as GiteeError).message,
        variant: 'destructive',
      })
    }
  }
}

export async function deleteFile({ path, sha, repo }: { path: string, sha: string, repo: string }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('giteeAccessToken')
  if (!accessToken) return;
  
  const giteeUsername = await store.get('giteeUsername')
  
  //
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    //
    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    
    const requestOptions = {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        access_token: accessToken,
        sha,
        message: `Delete ${path}`
      }),
      proxy
    };
    
    const normalizedPath = buildRepoContentPath({ path, preserveWhitespace: true });
    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}${buildRepoContentsEndpoint(normalizedPath)}`;
    
    const response = await fetch(url, requestOptions);
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return { data } as GiteeResponse<any>;
    }
    
    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Delete failed'
    };
  } catch (error) {
    toast({
      title: 'Delete failed',
      description: (error as GiteeError).message,
      variant: 'destructive',
    })
    // false undefined，
    return false;
  }
}

export async function getFileCommits({ path, repo }: { path: string, repo: string }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteeAccessToken')
  if (!accessToken) return;
  
  const giteeUsername = await store.get<string>('giteeUsername')
  
  //
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    //
    const params = new URLSearchParams();
    params.append('access_token', accessToken);
    params.append('path', path);
    params.append('per_page', '100');
    
    const requestOptions = {
      method: 'GET',
      proxy
    };
    
    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}/commits?${params.toString()}`;
    
    const response = await fetch(url, requestOptions);
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return data
    }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false
  }
}

// Gitee
export async function getUserInfo() {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteeAccessToken')
  if (!accessToken) {
    return;
  }
  
  //
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    //
    const params = new URLSearchParams();
    params.append('access_token', accessToken);
    
    const requestOptions = {
      method: 'GET',
      proxy,
      //
      timeout: 10000 // 10
    };
    
    const url = `https://gitee.com/api/v5/user?${params.toString()}`;
    
    const response = await fetch(url, requestOptions);
    const data = await response.json();
    
    //
    await store.set('giteeUsername', data.login);
    
    return data;
  } catch {
    // toast，
    throw {
      status: 0,
      message: 'Failed to fetch user info'
    };
  }
}

// Gitee
export async function checkSyncRepoState(name: string) {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteeAccessToken')
  if (!accessToken) {
    return;
  }
  
  const giteeUsername = await store.get<string>('giteeUsername')
  
  //
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    //
    const params = new URLSearchParams();
    params.append('access_token', accessToken);
    
    const requestOptions = {
      method: 'GET',
      proxy,
      //
      timeout: 10000 // 10
    };
    
    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${name}?${params.toString()}`;
    
    const response = await fetch(url, requestOptions);
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return data;
    }
    
    throw {
      status: response.status,
      message: 'Repository does not exist'
    };
  } catch (error) {
    if ((error as GiteeError).status === 404) {
      return null;
    }
    throw error;
  }
}

// Gitee
export async function createSyncRepo(name: string, isPrivate?: boolean) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('giteeAccessToken')
  if (!accessToken) return;
  
  //
  const proxyUrl = await store.get<string>('proxy')
  const proxy: Proxy | undefined = proxyUrl ? {
    all: proxyUrl
  } : undefined
  
  try {
    //
    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    
    const requestOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify({
        access_token: accessToken,
        name,
        private: isPrivate === undefined ? true : isPrivate,
        auto_init: false,
        description: 'Created automatically by NoteLoom'
      }),
      proxy
    };
    
    const url = `https://gitee.com/api/v5/user/repos`;
    
    const response = await fetch(url, requestOptions);
    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return data;
    }
    
    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Failed to create repository'
    };
  } catch (error) {
    toast({
      title: 'Failed to create repository',
      description: (error as GiteeError).message,
      variant: 'destructive',
    })
  }
}
