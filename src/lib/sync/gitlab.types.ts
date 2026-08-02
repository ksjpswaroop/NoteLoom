// Gitlab
export enum GitlabInstanceType {
  OFFICIAL = 'gitlab.com',      //
  JIHULAB = 'gitlab.cn',        // JiHu
  SELF_HOSTED = 'self-hosted'   //
}

// Gitlab
export interface GitlabInstanceConfig {
  type: GitlabInstanceType;
  baseUrl: string;
  name: string;
  description: string;
}

// Gitlab
export const GITLAB_INSTANCES: Record<GitlabInstanceType, GitlabInstanceConfig> = {
  [GitlabInstanceType.OFFICIAL]: {
    type: GitlabInstanceType.OFFICIAL,
    baseUrl: 'https://gitlab.com',
    name: 'GitLab.com',
    description: 'GitLab'
  },
  [GitlabInstanceType.JIHULAB]: {
    type: GitlabInstanceType.JIHULAB,
    baseUrl: 'https://jihulab.com',
    name: 'GitLab',
    description: 'GitLab'
  },
  [GitlabInstanceType.SELF_HOSTED]: {
    type: GitlabInstanceType.SELF_HOSTED,
    baseUrl: '',
    name: 'Self-hosted instance',
    description: 'GitLab'
  }
};

// Gitlab
export interface GitlabError {
  status: number;
  message: string;
}

// Gitlab
export interface GitlabUserInfo {
  id: number;
  username: string;
  name: string;
  state: string;
  avatar_url: string;
  web_url: string;
  created_at: string;
  bio: string;
  location: string;
  public_email: string;
  skype: string;
  linkedin: string;
  twitter: string;
  website_url: string;
  organization: string;
}

// Gitlab
export interface GitlabProjectInfo {
  id: number;
  name: string;
  name_with_namespace: string;
  path: string;
  path_with_namespace: string;
  created_at: string;
  updated_at: string;
  default_branch: string;
  description: string;
  web_url: string;
  avatar_url: string;
  star_count: number;
  forks_count: number;
  last_activity_at: string;
  namespace: {
    id: number;
    name: string;
    path: string;
    kind: string;
    full_path: string;
    avatar_url: string;
    web_url: string;
  };
  visibility: 'private' | 'internal' | 'public';
  issues_enabled: boolean;
  merge_requests_enabled: boolean;
  wiki_enabled: boolean;
  jobs_enabled: boolean;
  snippets_enabled: boolean;
  container_registry_enabled: boolean;
  service_desk_enabled: boolean;
  can_create_merge_request_in: boolean;
  issues_access_level: string;
  repository_access_level: string;
  merge_requests_access_level: string;
  forking_access_level: string;
  wiki_access_level: string;
  builds_access_level: string;
  snippets_access_level: string;
  pages_access_level: string;
  analytics_access_level: string;
  container_registry_access_level: string;
  security_and_compliance_access_level: string;
  releases_access_level: string;
  environments_access_level: string;
  feature_flags_access_level: string;
  infrastructure_access_level: string;
  monitor_access_level: string;
  model_experiments_access_level: string;
  model_registry_access_level: string;
}

// Gitlab
export interface GitlabFile {
  file_name: string;
  file_path: string;
  size: number;
  encoding: string;
  content_sha256: string;
  ref: string;
  blob_id: string;
  commit_id: string;
  last_commit_id: string;
  content?: string; // ，base64
}

// Gitlab
export interface GitlabRepositoryFile {
  id: string;
  name: string;
  type: 'tree' | 'blob';
  path: string;
  mode: string;
}

// Gitlab
export interface GitlabCommit {
  id: string;
  short_id: string;
  created_at: string;
  parent_ids: string[];
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  authored_date: string;
  committer_name: string;
  committer_email: string;
  committed_date: string;
  trailers: Record<string, string>;
  web_url: string;
}

// Gitlab API
export type GitlabResponse<T> = {
  data: T;
  status?: number;
  headers?: Record<string, string>;
}

// （）
export { SyncStateEnum } from './github.types';

// （）
export { RepoNames } from './github.types';
