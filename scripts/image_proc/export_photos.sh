#!/usr/bin/env bash

# setup -------------------------------------------------------------------

# This script:
# - Exports photos from the macOS Photos app
# - Resize them to 5 inches wide for landscape and 5 inches high for portait
# - Compresses photos to avif
# - Writes photo metadata (read with match_photos_to_nests.R)
#
# Before running you have to install exiftool and libavif
#
#   brew install exiftool libavif
#
# Run from the nest_study project root. Here's how with an album:
#
#   bash scripts/image_proc/export_photos.sh -a "[album name]"
#
# You can also run it on selected pictures instead of an album
#
#   bash scripts/image_proc/export_photos.sh

set -euo pipefail

# defaults ----------------------------------------------------------------

album=""
out_dir="data/photos/bulk"
long_edge=1500
quality=60
keep_staging=0
export_originals=0

usage() {
  cat >&2 <<'USAGE'
usage: export_photos.sh [-a ALBUM] [-o OUT_DIR] [-p PIXELS] [-q QUALITY] [-k]
                        [-O]

  -a ALBUM    top-level Photos album to export (default: current selection)
  -o OUT_DIR  where the .avif files and manifest land
              (default: data/photos/bulk)
  -p PIXELS   printed-edge size in pixels (default: 1500 = 5 in at 300 dpi)
  -q QUALITY  avifenc quality, 0-100, higher is bigger (default: 60)
  -k          keep the exported stills instead of deleting them
  -O          export unmodified originals instead of rendered stills; a live
              photo then arrives as a still plus a .mov, and an edited photo
              arrives unedited with a .AAE sidecar
USAGE
  exit 1
}

while getopts ":a:o:p:q:kOh" opt; do
  case "$opt" in
    a) album="$OPTARG" ;;
    o) out_dir="$OPTARG" ;;
    p) long_edge="$OPTARG" ;;
    q) quality="$OPTARG" ;;
    k) keep_staging=1 ;;
    O) export_originals=1 ;;
    *) usage ;;
  esac
done

# dependencies ------------------------------------------------------------

for tool in osascript sips exiftool avifenc shasum; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "export_photos: '$tool' is not on your PATH." >&2
    echo "  osascript and sips ship with macOS; for the rest run:" >&2
    echo "    brew install exiftool libavif" >&2
    exit 1
  fi
done

# libavif 1.x takes -q; older builds only understand --min/--max.

if avifenc --help 2>&1 | grep -q -- "--qcolor"; then
  avif_args=(-q "$quality" -s 6)
else
  avif_args=(--min 20 --max 35 -s 6)
fi

# staging -----------------------------------------------------------------

# out_dir is relative, so the wrong working directory would quietly scatter
# output instead of failing.

if [ ! -f "nest_study.Rproj" ]; then
  echo "export_photos: run this from the nest_study project root." >&2
  echo "  cd to the folder holding nest_study.Rproj, then try again." >&2
  exit 1
fi

mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"

scratch="$(mktemp -d "${TMPDIR:-/tmp}/nest_photo_export.XXXXXX")"
exported="$scratch/exported"
work="$scratch/work"
mkdir -p "$exported" "$work"

cleanup() {
  if [ "$keep_staging" -eq 0 ]; then
    rm -rf "$scratch"
  else
    echo "export_photos: exported files kept in $exported" >&2
    rm -rf "$work"
  fi
}
trap cleanup EXIT

echo "export_photos: exporting to $exported"

# Photos renders a live photo down to a single still unless originals are asked
# for, in which case the motion half arrives beside it as a .mov.

osascript - "$album" "$exported" "$export_originals" <<'APPLESCRIPT'
on run argv
  set albumName to item 1 of argv
  set destFolder to (POSIX file (item 2 of argv)) as alias
  set useOriginals to (item 3 of argv is "1")
  tell application "Photos"
    if albumName is "" then
      set theItems to selection
    else
      set theItems to (media items of album albumName)
    end if
    if (count of theItems) is 0 then
      error "export_photos: nothing to export (empty album or empty selection)"
    end if
    if useOriginals then
      export theItems to destFolder with using originals
    else
      export theItems to destFolder
    end if
  end tell
end run
APPLESCRIPT

echo "export_photos: exported files by extension:"

find "$exported" -type f ! -name '.*' |
  while IFS= read -r exported_file; do
    printf '%s\n' "${exported_file##*.}" | tr '[:upper:]' '[:lower:]'
  done |
  sort |
  uniq -c |
  while IFS= read -r tally; do
    echo "  $tally"
  done

# manifest ----------------------------------------------------------------

manifest="$out_dir/photo_manifest.csv"

# Quote every field so a comma or quote in a file name cannot shift columns.
# exiftool writes "-" for an absent tag; that becomes an empty cell here.

csv_field() {
  local value="${1:-}"
  if [ "$value" = "-" ]; then
    value=""
  fi
  value="${value//\"/\"\"}"
  printf '"%s"' "$value"
}

csv_row() {
  local out=""
  local field
  for field in "$@"; do
    if [ -n "$out" ]; then
      out="$out,"
    fi
    out="$out$(csv_field "$field")"
  done
  printf '%s\n' "$out"
}

csv_row \
  photo_id file_name file_path source_file \
  latitude longitude elevation bearing horizontal_accuracy \
  taken_local taken_offset taken_gps_utc \
  orientation source_width source_height > "$manifest"

# convert -----------------------------------------------------------------

converted=0
skipped=0
companions=0
ignored=0
failed=0

while IFS= read -r -d '' source_file; do

  # Under -O a live photo also yields a .mov and an edited one a .AAE sidecar,
  # both expected company for a still, so they are counted, not warned about.

  extension="$(printf '%s' "${source_file##*.}" | tr '[:upper:]' '[:lower:]')"

  case "$extension" in
    jpg|jpeg|heic|heif|png|tif|tiff|gif|bmp|webp|avif) ;;
    dng|cr2|cr3|nef|arw|raf|orf|rw2|srw|pef) ;;
    mov|mp4|m4v|aae)
      companions=$((companions + 1))
      continue
      ;;
    *)
      ignored=$((ignored + 1))
      echo "export_photos: not an image, ignored --" \
           "$(basename "$source_file")" >&2
      continue
      ;;
  esac

  # exiftool prints one value per line and "-" for an absent tag, so both calls
  # are read positionally. Dates need -d, which -n would override.

  numeric=()
  while IFS= read -r line; do
    numeric[${#numeric[@]}]="$line"
  done < <(
    exiftool -f -s3 -n -q -q \
      -ImageWidth -ImageHeight -Orientation \
      -GPSLatitude -GPSLongitude -GPSAltitude \
      -GPSImgDirection -GPSHPositioningError \
      "$source_file"
  )

  stamps=()
  while IFS= read -r line; do
    stamps[${#stamps[@]}]="$line"
  done < <(
    exiftool -f -s3 -q -q -d "%Y-%m-%dT%H:%M:%S" \
      -DateTimeOriginal -OffsetTimeOriginal -GPSDateTime \
      "$source_file"
  )

  source_width="${numeric[0]:--}"
  source_height="${numeric[1]:--}"
  orientation="${numeric[2]:--}"
  latitude="${numeric[3]:--}"
  longitude="${numeric[4]:--}"
  elevation="${numeric[5]:--}"
  bearing="${numeric[6]:--}"
  accuracy="${numeric[7]:--}"

  taken_local="${stamps[0]:--}"
  taken_offset="${stamps[1]:--}"
  taken_gps_utc="${stamps[2]:--}"

  # A content hash in the id keeps it stable across re-runs, so a re-export is
  # a no-op here and a replayed idempotency key at the upload step.

  stem="$(basename "$source_file")"
  stem="${stem%.*}"
  stem="$(printf '%s' "$stem" | tr -cs '[:alnum:]._-' '_')"
  digest="$(shasum -a 256 "$source_file" | cut -c1-8)"
  photo_id="${stem}_${digest}"
  file_name="${photo_id}.avif"
  file_path="$out_dir/$file_name"

  if [ -e "$file_path" ]; then
    skipped=$((skipped + 1))
  else

    # Portrait sets the height, landscape the width, and an already-small photo
    # is left alone: upscaling would invent detail the original never had.

    resample=()
    if [ "$source_width" != "-" ] && [ "$source_height" != "-" ]; then
      if [ "$source_width" -gt "$long_edge" ] ||
         [ "$source_height" -gt "$long_edge" ]; then
        if [ "$source_height" -gt "$source_width" ]; then
          resample=(--resampleHeight "$long_edge")
        else
          resample=(--resampleWidth "$long_edge")
        fi
      fi
    else
      resample=(--resampleHeightWidthMax "$long_edge")
    fi

    staged_png="$work/${photo_id}.png"

    # One unreadable or corrupt file should cost that file, not the batch, so
    # the two conversions warn and move on instead of tripping set -e.

    if ! sips -s format png ${resample[@]+"${resample[@]}"} "$source_file" \
         --out "$staged_png" >/dev/null 2>&1; then
      echo "export_photos: sips could not read $(basename "$source_file")" >&2
      rm -f "$staged_png"
      failed=$((failed + 1))
      continue
    fi

    if ! avifenc "${avif_args[@]}" "$staged_png" "$file_path" >/dev/null 2>&1
    then
      echo "export_photos: avifenc failed on $(basename "$source_file")" >&2
      rm -f "$staged_png" "$file_path"
      failed=$((failed + 1))
      continue
    fi

    rm -f "$staged_png"

    exiftool -q -q -overwrite_original -tagsFromFile "$source_file" \
      -all:all "$file_path" >/dev/null 2>&1 || true

    converted=$((converted + 1))
  fi

  csv_row \
    "$photo_id" "$file_name" "$file_path" "$source_file" \
    "$latitude" "$longitude" "$elevation" "$bearing" "$accuracy" \
    "$taken_local" "$taken_offset" "$taken_gps_utc" \
    "$orientation" "$source_width" "$source_height" >> "$manifest"

done < <(find "$exported" -type f ! -name '.*' -print0)

echo "export_photos: $converted converted, $skipped already present," \
     "$companions live-photo or edit companions, $ignored not images," \
     "$failed failed"
echo "export_photos: images in $out_dir"
echo "export_photos: manifest at $manifest"
