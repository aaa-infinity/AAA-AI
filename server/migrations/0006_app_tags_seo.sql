-- Store AI-generated metadata for smarter listings/search.
ALTER TABLE store_apps ADD COLUMN tags TEXT;
ALTER TABLE store_apps ADD COLUMN seo TEXT;
