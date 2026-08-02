import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { fetch, Proxy } from '@tauri-apps/plugin-http';
import { fetch as encodeFetch } from './encode-fetch'
import { buildRemoteLogicalPath, buildRepoContentPath, debugSyncPath, encodeRemoteFileContent } from './remote-file'
import { 
  GiteaInstanceType, 
  GiteaRepositoryInfo, 
  GITEA_INSTANCES, 
  GiteaError,
  GiteaUserInfo,
  GiteaCommit,
  GiteaResponse,
  GiteaDirectoryItem,
  GiteaFileContent
} from './gitea.types';

// Gitea API URL

function resolveUploadPath(path: string | undefined, filename: string | undefined, fallbackFilename: string) {
  if (filename) {
    return buildRemoteLogicalPath({ path, filename })
  }

  return path?.replace(/^\/+|\/+$/g, '') || fallbackFilename
}

export async function getGiteaApiBaseUrl(): Promise<string> {
  const store = await Store.load('store.json');
  const instanceType = await store.get<GiteaInstanceType>('giteaInstanceType') || GiteaInstanceType.OFFICIAL;

  if (instanceType === GiteaInstanceType.SELF_HOSTED) {
    let customUrl = await store.get<string>('giteaCustomUrl') || '';
    // ，
    customUrl = customUrl.replace(/\/+$/, '').trim();

    // URL
    if (!customUrl) {
      throw new Error('Gitea URL ， Gitea URL');
    }

    // URL
    if (!customUrl.startsWith('http://') && !customUrl.startsWith('https://')) {
      customUrl = 'http://' + customUrl;
    }

    return `${customUrl}/api/v1`;
  }

  const instance = GITEA_INSTANCES[instanceType];
  return `${instance.baseUrl}/api/v1`;
}

//
async function getCommonHeaders(): Promise<any> {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('giteaAccessToken');

  if (!accessToken) {
    throw new Error('Gitea Access Token');
  }

  const headers = {
    "Content-Type": 'application/json;charset=utf-8',
    "Authorization": `token ${accessToken}`,
  };

  return headers;
}

//
async function getProxyConfig(): Promise<Proxy | undefined> {
  const store = await Store.load('store.json');
  const proxyUrl = await store.get<string>('proxy');
  return proxyUrl ? { all: proxyUrl } : undefined;
}

/**
 * Gitea 
 * @param params 
 */
export async function uploadFile({
  file,
  filename,
  sha,
  message,
  repo,
  path
}: {
  file: string | Uint8Array;
  filename?: string;
  sha?: string;
  message?: string;
  repo: string;
  path?: string;
}) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');

    if (!giteaUsername) {
      throw new Error('Gitea Username is not configured');
    }

    const id = uuid();
    const targetPath = resolveUploadPath(path, filename, id)
    const normalizedPath = buildRepoContentPath({ path: targetPath })
    debugSyncPath('gitea.uploadFile', {
      inputPath: path,
      filename,
      targetPath,
      normalizedPath,
      hasSha: Boolean(sha),
    })

    // Base64（Gitea API ）
    const base64Content = encodeRemoteFileContent(file)

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    const requestBody: any = {
      branch: 'main',
      content: base64Content,
      message: message || `Upload ${filename || id}`,
      //
      dates: {
        author: new Date().toISOString(),
        committer: new Date().toISOString()
      }
    };

    // ， sha
    if (sha) {
      requestBody.sha = sha;
    }

    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${normalizedPath}`;
    // Gitea API: POST ，PUT
    const method = sha ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(requestBody),
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();
      return { data } as GiteaResponse<any>;
    }

    if (response.status === 400) {
      return null;
    }

    // 422 （ SHA ）， null
    if (response.status === 422) {
      return null;
    }

    // 404 ， POST
    if (response.status === 404) {
      const postMethod = 'POST';
      const postBody = { ...requestBody };
      delete postBody.sha; // POST sha

      const postResponse = await fetch(url, {
        method: postMethod,
        headers,
        body: JSON.stringify(postBody),
        proxy
      });

      if (postResponse.status >= 200 && postResponse.status < 300) {
        const data = await postResponse.json();
        return { data } as GiteaResponse<any>;
      }

      const postErrorData = await postResponse.json();
      throw {
        status: postResponse.status,
        message: postErrorData.message || 'Sync failed'
      } as GiteaError;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Sync failed'
    } as GiteaError;

  } catch (error) {
    toast({
      title: 'File Error',
      description: (error as GiteaError).message || 'File Error',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * （ sha ）
 * @param params 
 */
export async function updateFileContent({
  path,
  repo,
  content,
  message
}: {
  path: string;
  repo: string;
  content: string;
  message?: string;
}) {
  try {
    // ， sha
    const fileInfo = await getFiles({ path, repo });
    // getFiles （）（），
    const sha = fileInfo && !Array.isArray(fileInfo) ? fileInfo.sha : undefined;

    // uploadFile
    return await uploadFile({
      file: content,
      filename: path.split('/').pop() || path,
      sha,
      message: message || `Update ${path}`,
      repo,
      path: path.substring(0, path.lastIndexOf('/'))
    });
  } catch (error) {
    toast({
      title: 'UpdateFileFailed',
      description: (error as GiteaError).message || 'UpdateFile Error',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * Gitea 
 * @param params 
 */
export async function getFiles({ path, repo, sha }: { path: string; repo: string; sha?: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');

    if (!giteaUsername) {
      return null;
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // URL ，
    const encodedPath = buildRepoContentPath({ path });
    debugSyncPath('gitea.getFiles', {
      inputPath: path,
      encodedPath,
      sha,
    })
    // Gitea API sha commit/branch
    const shaParam = sha ? `?sha=${sha}` : '';
    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodedPath}${shaParam}`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json();

      // ，（ content）
      if (!Array.isArray(data)) {
        return {
          name: data.name,
          path: data.path,
          type: data.type === 'dir' ? 'dir' : 'file',
          sha: data.sha,
          content: data.content || '', // （base64）
        };
      }

      // ，
      return data.map((item: GiteaDirectoryItem) => {
        return {
          name: item.name,
          path: item.path,
          type: item.type === 'dir' ? 'dir' : 'file',
          sha: item.sha,
        }
      })
    }

    // ， null
    if (response.status === 404) {
      return null
    }

    // 401 ，
    if (response.status >= 400 && response.status < 500) {
      const errorData = await response.json().catch(() => ({}));
      throw {
        status: response.status,
        message: errorData.message || `FileListFailed: ${response.status}`
      } as GiteaError;
    }

    return null;

  } catch (error) {
    // ，
    if ((error as GiteaError).status) {
      throw error;
    }
    return null;
  }
}

/**
 * Gitea 
 * @param params 
 */
export async function deleteFile({ path, sha, repo }: { path: string; sha?: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      throw new Error('Username is not configured');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    const encodedPath = buildRepoContentPath({ path, preserveWhitespace: true })

    // sha，
    let fileSha = sha;
    if (!fileSha) {
      const fileUrl = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodedPath}`;
      const fileResponse = await fetch(fileUrl, {
        method: 'GET',
        headers,
        proxy
      });
      
      if (fileResponse.ok) {
        const fileData = await fileResponse.json() as GiteaFileContent;
        fileSha = fileData.sha;
      }
    }

    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodedPath}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        branch: 'main',
        message: `Delete ${path}`,
        sha: fileSha
      }),
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      return true
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Failed to delete file'
    } as GiteaError;

  } catch (error) {
    toast({
      title: 'Failed to delete file',
      description: (error as GiteaError).message || 'File Error',
      variant: 'destructive',
    });
    return null; //
  }
}

/**
 * 
 * @param params 
 */
export async function getFileCommits({ path, repo }: { path: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      return false;
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // Gitea API （sha ）， main
    // path ， 404
    const encodedPath = encodeURIComponent(path);
    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/commits?sha=main&path=${encodedPath}&per_page=100`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GiteaCommit[];
      return { data } as GiteaResponse<GiteaCommit[]>;
    }
    
    // 404 ， false（）
    return false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // ， toast
    return false;
  }
}

/**
 * commit 
 * @param params 
 */
/**
 * commit （ Git tree API）
 * @param params 
 */
export async function getFileContentFromCommit({ path, ref, repo }: { path: string; ref: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');

    if (!giteaUsername) {
      throw new Error('Username is not configured');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // commit ， tree SHA
    const commitUrl = `${baseUrl}/repos/${giteaUsername}/${repo}/git/commits/${ref}`;

    const commitResponse = await fetch(commitUrl, {
      method: 'GET',
      headers,
      proxy
    });

    if (!commitResponse.ok) {
      return null;
    }

    const commitData = await commitResponse.json();
    // tree SHA commit.tree.sha
    const treeSha = commitData.commit?.tree?.sha || commitData.tree?.sha;

    if (!treeSha) {
      return null;
    }

    // tree
    const treeUrl = `${baseUrl}/repos/${giteaUsername}/${repo}/git/trees/${treeSha}?recursive=1`;

    const treeResponse = await fetch(treeUrl, {
      method: 'GET',
      headers,
      proxy
    });

    if (!treeResponse.ok) {
      return null;
    }

    const treeData = await treeResponse.json();
    //
    const fileEntry = treeData.tree?.find((item: any) => item.path === path);

    if (!fileEntry || fileEntry.type !== 'blob') {
      return null;
    }

    //
    const blobUrl = `${baseUrl}/repos/${giteaUsername}/${repo}/git/blobs/${fileEntry.sha}`;

    const blobResponse = await fetch(blobUrl, {
      method: 'GET',
      headers,
      proxy
    });

    if (!blobResponse.ok) {
      return null;
    }

    const blobData = await blobResponse.json();

    return {
      content: blobData.content || '',
      encoding: blobData.encoding || 'base64'
    };

  } catch {
    return null;
  }
}

export async function getFileContent({ path, ref, repo }: { path: string; ref: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      throw new Error('Username is not configured');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // commit ， path
    // getFiles ：
    const encodedPath = buildRepoContentPath({ path });
    debugSyncPath('gitea.getFileContent', {
      inputPath: path,
      encodedPath,
      ref,
    })
    // Gitea API sha ref commit
    const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodedPath}?sha=${ref}`;

    const response = await encodeFetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GiteaFileContent;
      return {
        content: data.content || '',
        encoding: data.encoding || 'base64'
      };
    }

    if (response.status >= 400 && response.status < 500) {
      return {
        content: '',
        encoding: 'base64'
      }
    }

    const errorData = await response.text();
    throw {
      status: response.status,
      message: errorData || 'Failed to get file content'
    } as GiteaError;

  } catch (error) {
    toast({
      title: 'Failed to get file content',
      description: (error as GiteaError).message || 'File Error',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * Gitea 
 * @param token 
 */
export async function getUserInfo(token?: string): Promise<GiteaUserInfo> {
  try {
    const store = await Store.load('store.json');
    const accessToken = token || await store.get<string>('giteaAccessToken');
    
    if (!accessToken) {
      throw new Error('Access token is not configured');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const proxy = await getProxyConfig();

    const headers = new Headers();
    headers.append('Authorization', `token ${accessToken}`);
    headers.append('Content-Type', 'application/json');

    const response = await fetch(`${baseUrl}/user`, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const userInfo = await response.json() as GiteaUserInfo;
      
      //
      await store.set('giteaUsername', userInfo.login);
      await store.save();
      
      return userInfo;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Failed to fetch user info'
    } as GiteaError;

  } catch (error) {
    toast({
      title: 'Failed to fetch user info',
      description: (error as GiteaError).message || 'Error',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * 
 * @param name 
 */
export async function checkSyncRepoState(name: string): Promise<GiteaRepositoryInfo | null> {
  try {
    const store = await Store.load('store.json');
    const giteaUsername = await store.get<string>('giteaUsername');
    
    if (!giteaUsername) {
      throw new Error('Username is not configured');
    }

    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    //
    const repoUrl = `${baseUrl}/repos/${giteaUsername}/${name}`;
    
    const response = await fetch(repoUrl, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const repo = await response.json() as GiteaRepositoryInfo;
      return repo;
    }

    if (response.status === 404) {
      return null;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Failed'
    } as GiteaError;

  } catch (error) {
    throw error;
  }
}

/**
 * 
 * @param name 
 * @param isPrivate 
 */
export async function createSyncRepo(name: string, isPrivate: boolean = true): Promise<GiteaRepositoryInfo | null> {
  try {
    const baseUrl = await getGiteaApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    const requestBody = {
      name: name,
      description: `note-gen - ${name}`,
      private: isPrivate,
      auto_init: true,
      default_branch: 'main'
    };

    const response = await fetch(`${baseUrl}/user/repos`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const repo = await response.json() as GiteaRepositoryInfo;
      return repo;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Failed to create repository'
    } as GiteaError;

  } catch (error) {
    toast({
      title: 'Failed to create repository',
      description: (error as GiteaError).message || 'Error',
      variant: 'destructive',
    });
    return null;
  }
}
