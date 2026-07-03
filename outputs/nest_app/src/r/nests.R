library(tidyverse)
library(htmltools)

# A single nest on the Nests page is now a button that opens the Nest info page
# (window.fieldOpenNestInfo); it is no longer an accordion.

nest_button <-
  function(.x) {
    dc <- if (isTRUE(.x$is_current[[1]])) "true" else "false"
    tags$button(
      type = "button",
      class = "field-nest-btn",
      `data-current` = dc,
      `data-patch` = .x$patch_id[[1]],
      `data-nest` = .x$nest_id[[1]],
      onclick = paste0("window.fieldOpenNestInfo('", .x$nest_id[[1]], "')"),
      tags$strong(paste0(.x$nest_id[[1]], ".")),
      paste0(" ", .x$species[[1]])
    )
  }

nest_toggle <-
  function(id, label, checked = TRUE) {
    tags$label(
      class = "field-toggle",
      tags$input(
        type = "checkbox",
        id = id,
        class = "field-toggle-input",
        checked = if (checked) NA else NULL
      ),
      tags$span(
        class = "field-toggle-track",
        tags$span(class = "field-toggle-thumb")
      ),
      tags$span(class = "field-toggle-label", label)
    )
  }

# Shared prep: one summarized row per nest plus its interval list-column. Wrapped
# so a data problem degrades gracefully instead of breaking the whole page.

nest_prep <-
  tryCatch(
    {
      field_nests <-
        here::here("data/field_data.rds") %>%
        read_rds() %>%
        pluck("nests") %>%
        filter(nest_id != "N031")

      current_nest_ids <-
        tryCatch(
          here::here("data/current_nests.rds") %>%
            read_rds() %>%
            pull(nest_id),
          error = function(e) NULL
        )

      nest_intervals <-
        field_nests %>%
        select(nest_id, interval_data)

      nests_start <-
        field_nests %>%
        unnest(interval_data) %>%
        summarize(
          last_check = last(date),
          last_status = last(nest_status),
          .by =
            c(
              nest_id:patch_id,
              height,
              substrate,
              location_description,
              discovery_date
            )
        ) %>%
        left_join(nest_intervals, by = "nest_id") %>%
        mutate(
          across(
            where(is.character),
            ~ replace_na(.x, "Unknown")
          ),
          is_current =
            str_starts(patch_id, "test_") |
            (if (is.null(current_nest_ids)) TRUE else nest_id %in% current_nest_ids)
        )

      nests_start
    },
    error = function(e) NULL
  )

# Compact per-nest payload for the Nest info page (discovery summary + the
# interval checks the info page turns into a bullet list). Keyed by nest_id.

nest_info_json <-
  tryCatch(
    {
      nest_prep %>%
        split(.$nest_id) %>%
        map(
          function(.n) {
            iv <- .n$interval_data[[1]]
            intervals <-
              if (is.null(iv) || nrow(iv) == 0) {
                list()
              } else {
                iv %>%
                  transmute(
                    date = as.character(date),
                    host_eggs = suppressWarnings(as.numeric(host_eggs)),
                    host_young = suppressWarnings(as.numeric(host_young)),
                    bhco_eggs = suppressWarnings(as.numeric(bhco_eggs)),
                    bhco_young = suppressWarnings(as.numeric(bhco_young))
                  ) %>%
                  transpose()
              }
            list(
              species = .n$species[[1]],
              patch_id = .n$patch_id[[1]],
              substrate = .n$substrate[[1]],
              height = as.character(.n$height[[1]]),
              location_description = .n$location_description[[1]],
              discovery_date = as.character(.n$discovery_date[[1]]),
              last_check = as.character(.n$last_check[[1]]),
              last_status = .n$last_status[[1]],
              intervals = intervals
            )
          }
        ) %>%
        jsonlite::toJSON(auto_unbox = TRUE, na = "null")
    },
    error = function(e) "{}"
  )

nest_panels <-
  if (is.null(nest_prep)) {
    tags$p("Nest information is currently unavailable.")
  } else {
    nest_list <-
      nest_prep %>%
      split(.$nest_id)

    test_patch_labels <-
      c(
        test_snedgen_park = "Test: Snedgen Park",
        test_long_branch = "Test: Long branch"
      )

    patch_list <-
      nest_prep %>%
      split(.$patch_id)

    patch_list[setdiff(names(test_patch_labels), names(patch_list))] <-
      list(nest_prep[0, ])

    patch_list <-
      patch_list[
        c(
          setdiff(names(patch_list), names(test_patch_labels)),
          intersect(names(test_patch_labels), names(patch_list))
        )
      ]

    tagList(
      tags$div(
        class = "nest-toggles",
        nest_toggle("nestGroupToggle", "Group by patch"),
        nest_toggle("nestCurrentToggle", "Current nests"),
        nest_toggle("nestTodayToggle", "Today's nests", checked = FALSE)
      ),
      tags$div(
        id = "nest-view-all",
        class = "nest-view",
        style = "display: none;",
        tags$div(
          class = "nest-btn-group",
          map(nest_list, nest_button)
        )
      ),
      tags$div(
        id = "nest-view-patch",
        class = "nest-view",
        tags$div(
          class = "accordion-group patch-accordion-group",
          imap(
            patch_list,
            function(.x, .y) {
              patch_dc <-
                if (any(.x$is_current) || str_starts(.y, "test_")) "true" else "false"
              tagList(
                tags$button(
                  class = "accordion patch-accordion",
                  `data-current` = patch_dc,
                  `data-patch` = .y,
                  tags$strong(coalesce(unname(test_patch_labels[.y]), .y)),
                  " (",
                  tags$span(class = "patch-count-current", sum(.x$is_current)),
                  tags$span(class = "patch-count-all", nrow(.x)),
                  " nests)"
                ),
                tags$div(
                  class = "panel patch-panel",
                  `data-current` = patch_dc,
                  tags$div(
                    class = "nest-btn-group",
                    map(
                      split(.x, .x$nest_id),
                      nest_button
                    )
                  )
                )
              )
            }
          )
        )
      )
    )
  }
