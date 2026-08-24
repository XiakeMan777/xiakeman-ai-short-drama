ALTER TABLE xiakeman_cloud_project_blobs
  DROP CONSTRAINT IF EXISTS xiakeman_cloud_project_blobs_object_key_key;

CREATE INDEX IF NOT EXISTS xiakeman_cloud_project_blobs_hash_idx
  ON xiakeman_cloud_project_blobs (user_id, project_id, sha256, size_bytes);

CREATE INDEX IF NOT EXISTS xiakeman_cloud_project_blobs_object_idx
  ON xiakeman_cloud_project_blobs (object_key);
