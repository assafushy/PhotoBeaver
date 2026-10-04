export interface ItemHashes {
  quickXorHash?: string;
  sha256Hash?: string;
}

export interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  webUrl?: string;
  cTag?: string;
  eTag?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string; hashes?: ItemHashes };
  folder?: object;
  root?: object;
  deleted?: object;
  photo?: { takenDateTime?: string };
  video?: { duration?: number; width?: number; height?: number };
  image?: { width?: number; height?: number };
  location?: { latitude?: number; longitude?: number };
  parentReference?: { id?: string; path?: string };
}

export interface DeltaPage {
  value: DriveItem[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface GraphUser {
  userPrincipalName?: string | null;
  mail?: string | null;
}

export interface ThumbnailInfo {
  url?: string;
}

export interface DownloadInfo {
  '@microsoft.graph.downloadUrl'?: string;
}
