export interface PollingConfig {
  pollInterval?: string;
  timeoutIn?: string;
}

export interface PickingSession {
  id: string;
  pickerUri: string;
  pollingConfig?: PollingConfig;
  expireTime?: string;
  mediaItemsSet?: boolean;
}

export interface MediaFileMetadata {
  width?: number | string;
  height?: number | string;
  cameraMake?: string;
  cameraModel?: string;
}

export interface PickedMediaFile {
  baseUrl: string;
  mimeType?: string;
  filename?: string;
  mediaFileMetadata?: MediaFileMetadata;
}

export interface PickedMediaItem {
  id: string;
  createTime?: string;
  type?: 'TYPE_UNSPECIFIED' | 'PHOTO' | 'VIDEO';
  mediaFile: PickedMediaFile;
}

export interface MediaItemsPage {
  mediaItems?: PickedMediaItem[];
  nextPageToken?: string;
}
