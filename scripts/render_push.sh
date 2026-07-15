# render_push.sh -----------------------------------------------------------
# Render the field map and deploy it to GitHub Pages.
# Run in a local terminal, from the nest_study project root:
#
#   bash scripts/render_push.sh
#
# The app is self-contained and version-controlled in outputs/nest_app_api:
# source (field_map.qmd, src/) and build output (index.html, field_*.js,
# field_map_files/) sit side by side, so the render writes in place and there is
# no staging tree to copy from.

set -e

APP=outputs/nest_app_api

quarto render "$APP/field_map.qmd"

# The service worker must sit BESIDE index.html so its scope covers the whole
# app folder on Pages; its source lives in src/. This is the only built file the
# render does not already put where it is served from.
cp "$APP/src/sw.js" "$APP/sw.js"

# Safety net: every LOCAL asset index.html references must exist. Skips absolute
# URLs, data: URIs and anchors. Aborts (no deploy) if any are missing.
missing=0
for ref in $(grep -oE '(src|href)="[^"]+"' "$APP/index.html" \
             | sed -E 's/.*="([^"]+)"/\1/' | sort -u); do
  case "$ref" in
    data:*|http:*|https:*|//*|\#*|mailto:*) continue ;;
  esac
  if [ ! -e "$APP/$ref" ]; then
    echo "MISSING referenced asset: $ref" >&2
    missing=1
  fi
done

if [ "$missing" = 1 ]; then
  echo "ABORT: index.html references files that are not present. Not deploying." >&2
  exit 1
fi

echo "shell size: $(du -h "$APP/index.html" | cut -f1)"

git add .
git commit -m "render + push field map"
git push
