CREATE VIRTUAL TABLE `faces_vec` USING vec0(face_id TEXT PRIMARY KEY, embedding float[512] distance_metric=cosine);
