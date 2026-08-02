import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { fetch, Proxy } from '@tauri-apps/plugin-http';
import { fetch as encodeFetch } from './encode-fetch'
import { buildRemoteLogicalPath, debugSyncPath, encodeRemoteFileContent } from './remote-file'
import { 
  GitlabInstanceType, 
  GitlabProjectInfo, 
  GITLAB_INSTANCES, 
  GitlabError,
  GitlabUserInfo,
  GitlabCommit,
  GitlabResponse,
  GitlabRepositoryFile
} from './gitlab.types';

// Gitlab API URL

function resolveUploadPath(path: string | undefined, filename: string | undefined, fallbackFilename: string) {
  if (filename) {
    return buildRemoteLogicalPath({ path, filename })
  }

  return path?.replace(/^\/+|\/+$/g, '') || fallbackFilename
}

async function getGitlabApiBaseUrl(): Promise<string> {
  const store = await Store.load('store.json');
  const instanceType = await store.get<GitlabInstanceType>('gitlabInstanceType') || GitlabInstanceType.OFFICIAL;

  if (instanceType === GitlabInstanceType.SELF_HOSTED) {
    let customUrl = await store.get<string>('gitlabCustomUrl') || '';
    // ，
    customUrl = customUrl.replace(/\/+$/, '').trim();

    // URL
    if (!customUrl) {
      throw new Error('Self-hosted GitLab URL is not configured. Enter a GitLab URL in settings first.');
    }

    // URL
    if (!customUrl.startsWith('http://') && !customUrl.startsWith('https://')) {
      customUrl = 'https://' + customUrl;
    }

    return `${customUrl}/api/v4`;
  }

  const instance = GITLAB_INSTANCES[instanceType];
  return `${instance.baseUrl}/api/v4`;
}

//
async function getCommonHeaders(): Promise<any> {
  const store = await Store.load('store.json');
  const accessToken = await store.get<string>('gitlabAccessToken');

  if (!accessToken) {
    throw new Error('GitLab Access Token');
  }

  const headers = {
    "Content-Type": 'application/json;charset=iso-8859-1',
    "PRIVATE-TOKEN": accessToken,
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
 * Gitlab 
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
    const gitlabUsername = await store.get<string>('gitlabUsername');
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);
    
    if (!gitlabUsername || !projectId) {
      throw new Error('Gitlab Project ID is not configured');
    }

    const id = uuid();
    const targetPath = resolveUploadPath(path, filename, id);
    const encodedTargetPath = encodeURIComponent(targetPath);
    debugSyncPath('gitlab.uploadFile', {
      inputPath: path,
      filename,
      targetPath,
      encodedTargetPath,
      hasSha: Boolean(sha),
    })

    // Base64（GitLab API ）
    const base64Content = encodeRemoteFileContent(file)

    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();
    debugSyncPath('gitlab.uploadFile.requestPath', {
      inputPath: path,
      targetPath,
      encodedTargetPath,
    })

    const requestBody = {
      branch: 'main',
      content: base64Content,
      commit_message: message || `Upload ${filename || id}`,
      encoding: 'base64'
    };

    // ， last_commit_id
    if (sha) {
      // ID
      const commitsUrl = `${baseUrl}/projects/${projectId}/repository/commits?path=${encodeURIComponent(targetPath)}&per_page=1`;
      const commitsResponse = await fetch(commitsUrl, {
        method: 'GET',
        headers,
        proxy
      });

      if (commitsResponse.ok) {
        const commits = await commitsResponse.json() as GitlabCommit[];
        if (commits.length > 0) {
          (requestBody as any).last_commit_id = commits[0].id;
        }
      }
    }

    const url = `${baseUrl}/projects/${projectId}/repository/files/${encodedTargetPath}`;

    // Commits API （）
    // GitLab Commits API commit ，
    const commitsApiUrl = `${baseUrl}/projects/${projectId}/repository/commits`;

    const commitActions = [{
      action: sha ? 'update' : 'create',
      file_path: targetPath,
      content: base64Content,
      encoding: 'base64'
    }];

    const commitBody = {
      branch: 'main',
      commit_message: message || `Upload ${filename || id}`,
      actions: commitActions
    };

    const commitResponse = await fetch(commitsApiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(commitBody),
      proxy
    });

    if (commitResponse.status >= 200 && commitResponse.status < 300) {
      const data = await commitResponse.json();
      return { data } as GitlabResponse<any>;
    }

    // 400 ，， PUT
    if (commitResponse.status === 400) {
      const commitErrorData = await commitResponse.json();

      //
      if (commitErrorData.error && commitErrorData.error.includes('already exists')) {
        // SHA
        const fileUrl = `${baseUrl}/projects/${projectId}/repository/files/${encodedTargetPath}?ref=main`;
        const fileResponse = await fetch(fileUrl, {
          method: 'GET',
          headers,
          proxy
        });

        let fileSha = '';
        if (fileResponse.ok) {
          const fileData = await fileResponse.json();
          fileSha = fileData.blob_id || fileData.sha;
        }

        // PUT
        const putBody = {
          branch: 'main',
          content: base64Content,
          commit_message: message || `Update ${filename || id}`,
          encoding: 'base64',
          sha: fileSha
        };

        const putResponse = await fetch(url, {
          method: 'PUT',
          headers,
          body: JSON.stringify(putBody),
          proxy
        });

        if (putResponse.status >= 200 && putResponse.status < 300) {
          const data = await putResponse.json();
          return { data } as GitlabResponse<any>;
        }

        const putErrorData = await putResponse.json();
        throw {
          status: putResponse.status,
          message: putErrorData.message || 'Failed to update file'
        } as GitlabError;
      }

      throw {
        status: commitResponse.status,
        message: commitErrorData.error || 'Failed to update file'
      } as GitlabError;
    }

    //
    const commitErrorData = await commitResponse.json();
    throw {
      status: commitResponse.status,
      message: commitErrorData.error || commitErrorData.message || 'Failed to update file'
    } as GitlabError;

  } catch (error) {
    toast({
      title: 'Sync failed',
      description: (error as GitlabError).message || 'Sync failed',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * Gitlab 
 * @param params 
 */
export async function getFiles({ path, repo }: { path: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);

    if (!projectId) {
      throw new Error('Project ID is not configured');
    }

    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();
    debugSyncPath('gitlab.getFiles', {
      inputPath: path,
      filePath: encodeURIComponent(path),
      treePath: encodeURIComponent(path),
    })

    //
    const fileUrl = `${baseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(path)}?ref=main`;

    try {
      const fileResponse = await fetch(fileUrl, {
        method: 'GET',
        headers,
        proxy
      });

      if (fileResponse.status >= 200 && fileResponse.status < 300) {
        const fileData = await fileResponse.json();
        // ， sha ( blob_id sha)
        return {
          name: fileData.file_name,
          path: fileData.file_path,
          sha: fileData.blob_id,
          size: fileData.size,
        };
      }
    } catch {
      // ，
    }

    // ，
    const url = `${baseUrl}/projects/${projectId}/repository/tree?path=${encodeURIComponent(path)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GitlabRepositoryFile[];
      return data.map(item => {
        return {
          name: item.name,
          path: item.path,
          type: item.type === 'tree' ? 'dir' : 'file',
          sha: item.id,
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
      } as GitlabError;
    }

    return null;

  } catch (error) {
    // ，
    if ((error as GitlabError).status) {
      throw error;
    }
    // ， toast，
    return null;
  }
}

/**
 * Gitlab 
 * @param params 
 */
export async function deleteFile({ path, repo }: { path: string; sha?: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);
    
    if (!projectId) {
      throw new Error('Project ID is not configured');
    }

    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // ID， path
    const encodedPath = encodeURIComponent(path);
    const commitsUrl = `${baseUrl}/projects/${projectId}/repository/commits?path=${encodedPath}&per_page=1`;
    const commitsResponse = await fetch(commitsUrl, {
      method: 'GET',
      headers,
      proxy
    });

    let lastCommitId = '';
    if (commitsResponse.ok) {
      const commits = await commitsResponse.json() as GitlabCommit[];
      if (commits.length > 0) {
        lastCommitId = commits[0].id;
      }
    }

    const url = `${baseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(path)}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        branch: 'main',
        commit_message: `Delete ${path}`,
        last_commit_id: lastCommitId
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
    } as GitlabError;

  } catch (error) {
    toast({
      title: 'Failed to delete file',
      description: (error as GitlabError).message || 'Sync failed',
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
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);
    
    if (!projectId) {
      return false;
    }

    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // path ， 404
    const encodedPath = encodeURIComponent(path);
    const url = `${baseUrl}/projects/${projectId}/repository/commits?path=${encodedPath}&per_page=100`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const data = await response.json() as GitlabCommit[];
      return { data } as GitlabResponse<GitlabCommit[]>;
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
export async function getFileContent({ path, ref, repo }: { path: string; ref: string; repo: string }) {
  try {
    const store = await Store.load('store.json');
    const projectId = await store.get<string>(`gitlab_${repo}_project_id`);
    
    if (!projectId) {
      throw new Error('Project ID is not configured');
    }

    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    // Gitlab API commit
    const url = `${baseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(path)}/raw?ref=${ref}`;

    const response = await encodeFetch(url, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const content = new Uint8Array(await response.arrayBuffer());
      // Base64，。
      const base64Content = encodeRemoteFileContent(content);
      return {
        content: base64Content,
        encoding: 'base64'
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
    } as GitlabError;

  } catch (error) {
    toast({
      title: 'Failed to get file content',
      description: (error as GitlabError).message || 'Sync failed',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * Gitlab 
 * @param token 
 */
export async function getUserInfo(token?: string): Promise<GitlabUserInfo> {
  try {
    const store = await Store.load('store.json');
    const accessToken = token || await store.get<string>('gitlabAccessToken');
    
    if (!accessToken) {
      throw new Error('Access token is not configured');
    }

    const baseUrl = await getGitlabApiBaseUrl();
    const proxy = await getProxyConfig();

    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Content-Type', 'application/json');

    const response = await fetch(`${baseUrl}/user`, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const userInfo = await response.json() as GitlabUserInfo;
      
      //
      await store.set('gitlabUsername', userInfo.username);
      await store.save();
      
      return userInfo;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Failed to fetch user info'
    } as GitlabError;

  } catch (error) {
    toast({
      title: 'Failed to fetch user info',
      description: (error as GitlabError).message || 'Error',
      variant: 'destructive',
    });
    throw error;
  }
}

/**
 * 
 * @param name 
 */
export async function checkSyncProjectState(name: string): Promise<GitlabProjectInfo | null> {
  try {
    const store = await Store.load('store.json');
    const gitlabUsername = await store.get<string>('gitlabUsername');
    
    if (!gitlabUsername) {
      throw new Error('Username is not configured');
    }

    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    //
    const searchUrl = `${baseUrl}/projects?search=${name}&owned=true&per_page=10`;
    
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers,
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const projects = await response.json() as GitlabProjectInfo[];
      
      //
      const project = projects.find(p => p.name === name && p.namespace.path === gitlabUsername);
      
      if (project) {
        // ID
        await store.set(`gitlab_${name}_project_id`, project.id.toString());
        await store.save();
      }
      
      return project || null;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Failed'
    } as GitlabError;

  } catch (error) {
    throw error;
  }
}

/**
 * 
 * @param name 
 * @param isPrivate 
 */
export async function createSyncProject(name: string, isPrivate: boolean = true): Promise<GitlabProjectInfo | null> {
  try {
    const baseUrl = await getGitlabApiBaseUrl();
    const headers = await getCommonHeaders();
    const proxy = await getProxyConfig();

    const requestBody = {
      name: name,
      path: name,
      description: `note-gen - ${name}`,
      visibility: isPrivate ? 'private' : 'public',
      initialize_with_readme: true,
      default_branch: 'main'
    };

    const response = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      proxy
    });

    if (response.status >= 200 && response.status < 300) {
      const project = await response.json() as GitlabProjectInfo;
      
      // ID
      const store = await Store.load('store.json');
      await store.set(`gitlab_${name}_project_id`, project.id.toString());
      await store.save();
      
      return project;
    }

    const errorData = await response.json();
    throw {
      status: response.status,
      message: errorData.message || 'Failed'
    } as GitlabError;

  } catch (error) {
    toast({
      title: 'Failed',
      description: (error as GitlabError).message || 'Error',
      variant: 'destructive',
    });
    return null;
  }
}
