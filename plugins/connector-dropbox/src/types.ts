export interface DropboxFile {
  '.tag': 'file';
  id: string;
  name: string;
  path_lower: string;
  path_display: string;
  rev: string;
  size: number;
  server_modified: string;
  client_modified?: string;
  content_hash?: string;
}

export interface DropboxFolder {
  '.tag': 'folder';
  id: string;
  name: string;
  path_lower: string;
  path_display: string;
}

export interface DropboxDeleted {
  '.tag': 'deleted';
  name: string;
  path_lower: string;
  path_display: string;
}

export type DropboxEntry = DropboxFile | DropboxFolder | DropboxDeleted;

export interface ListFolderResult {
  entries: DropboxEntry[];
  cursor: string;
  has_more: boolean;
}

export interface DropboxAccount {
  account_id: string;
  email: string;
  name?: { display_name?: string };
}
