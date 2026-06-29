# Re-externalize the field data files after a Quarto render.
#
# field_map.qmd loads field_static.js / field_data.js via <script src>, but
# `embed-resources: true` inlines them into index.html. Each data file starts
# with a marker comment; this finds the inlined block and swaps it back to an
# external <script src>, so the served shell stays small and only the tiny
# field_data.js changes on a daily update. Defensive: if the markers are not
# found (data was not inlined), index.html is left untouched.

externalize_field_data <-
  function(html = here::here("outputs/nest_app/index.html")) {
    txt <- readr::read_file(html)

    de_inline <-
      function(.txt, .pattern, .src) {
        stringr::str_replace(
          .txt,
          stringr::regex(
            stringr::str_c("<script[^>]*>\\s*", .pattern, ".*?</script>"),
            dotall = TRUE
          ),
          stringr::str_c("<script src=\"", .src, "\"></script>")
        )
      }

    txt <- de_inline(txt, "/\\* field_patches\\.js \\*/", "field_patches.js")
    txt <- de_inline(txt, "/\\* field_icons\\.js \\*/", "field_icons.js")
    txt <- de_inline(txt, "/\\* field_offline_tiles\\.js \\*/", "field_offline_tiles.js")
    txt <- de_inline(txt, "/\\* field_data\\.js \\*/", "field_data.js")

    if (!stringr::str_detect(txt, "src=\"field_data\\.js\"")) {
      message(
        "externalize_field_data(): data files were not inlined as expected; ",
        "left ", html, " unchanged."
      )
    }

    readr::write_file(txt, html)
  }
