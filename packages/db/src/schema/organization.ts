import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';
import { assets } from './assets';
import { sources } from './sources';

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['user', 'auto', 'place'] }).notNull(),
  },
  (t) => [unique('tags_name_kind_unique').on(t.name, t.kind)],
);

export const assetTags = sqliteTable(
  'asset_tags',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    pluginId: text('plugin_id'),
    confidence: real('confidence'),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.tagId] }), index('asset_tags_tag_idx').on(t.tagId)],
);

export const people = sqliteTable('people', {
  id: text('id').primaryKey(),
  name: text('name'),
  coverFaceId: text('cover_face_id'),
  createdAt: integer('created_at'),
});

export const faces = sqliteTable('faces', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').references(() => assets.id, { onDelete: 'cascade' }),
  pluginId: text('plugin_id'),
  bboxJson: text('bbox_json'),
  confidence: real('confidence'),
  personId: text('person_id').references(() => people.id),
  assignedBy: text('assigned_by', { enum: ['user', 'auto'] }),
});

export const albums = sqliteTable('albums', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sourceId: text('source_id').references(() => sources.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  createdAt: integer('created_at'),
});

export const albumAssets = sqliteTable(
  'album_assets',
  {
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    position: integer('position'),
  },
  (t) => [primaryKey({ columns: [t.albumId, t.assetId] })],
);
