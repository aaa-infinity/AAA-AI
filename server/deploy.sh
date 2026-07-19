#!/usr/bin/env bash
# Reliable deploy for aaa-ai-bot.
# Clears the wrangler build cache first so the deployed code always matches
# server/src/index.js (otherwise stale bundles could be served).
set -e
cd "$(dirname "$0")"
set -a; . ../.credentials.local; set +a
rm -rf .wrangler node_modules/.wrangler

# Rebuild the open-source knowledge-base corpus (docs/opensource/*.md) and push
# it to KV so the AI brain can retrieve it at runtime.
ROOT="$(cd .. && pwd)"
CORPUS_TMP="$(mktemp)"
if [ -d "$ROOT/docs/opensource" ]; then
  python3 - "$ROOT/docs/opensource" "$CORPUS_TMP" <<'PY'
import re, os, sys
src, out = sys.argv[1], sys.argv[2]
parts=[]
for fn in sorted(os.listdir(src)):
    if fn=="SOURCES.md": continue
    p=os.path.join(src,fn)
    t=open(p,encoding="utf-8",errors="ignore").read()
    t=re.sub(r'^\s*<[^>]+>\s*$','',t,flags=re.M)
    t=re.sub(r'!\[[^\]]*\]\([^)]*\)','',t)
    t=re.sub(r'\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)','',t)
    t=re.sub(r'\n{3,}','\n\n',t)
    parts.append("# SOURCE: %s\n\n%s"%(fn,t.strip()))
open(out,"w",encoding="utf-8").write("\n\n---\n\n".join(parts))
PY
  if [ -s "$CORPUS_TMP" ]; then
    echo "Uploading knowledge-base corpus to KV ($(wc -c < "$CORPUS_TMP") bytes)..."
    wrangler kv key put "kb_corpus" --binding AAA_KV --remote --path "$CORPUS_TMP" || echo "WARN: kb_corpus upload failed"
  fi
  rm -f "$CORPUS_TMP"
fi

echo "Deploying aaa-ai-bot (fresh build)..."
npx -y wrangler deploy --name aaa-ai-bot "$@"
