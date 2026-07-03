library(tidyverse)
library(htmltools)

# One interval-level check rendered as an accordion inside the View detail:
# the title carries the check's date/time, the panel lists its fields.

interval_check_accordion <-
  function(.row) {
    field_item <-
      function(label, value) {
        tags$li(tags$strong(label), ": ", as.character(value %||% "--"))
      }
    tagList(
      tags$button(
        class = "accordion",
        tags$strong(as.character(.row$date %||% "--")),
        paste0(" ", as.character(.row$time %||% ""))
      ),
      tags$div(
        class = "panel",
        tags$ul(
          field_item("Adult present", .row$adult_present),
          field_item("Adult activity", .row$adult_activity),
          field_item("Host eggs", .row$host_eggs),
          field_item("Host young", .row$host_young),
          field_item("Host dead young", .row$host_dead_young),
          field_item("BHCO eggs", .row$bhco_eggs),
          field_item("BHCO young", .row$bhco_young),
          field_item("BHCO dead young", .row$bhco_dead_young),
          field_item("Nest status", .row$nest_status),
          field_item("Young status", .row$young_status),
          field_item("Observer", .row$observer),
          field_item("Notes", .row$notes)
        )
      )
    )
  }

nest_accordion <-
  function(.x) {
    dc <- if (isTRUE(.x$is_current[[1]])) "true" else "false"
    intervals <- .x$interval_data[[1]]
    interval_accordions <-
      if (is.null(intervals) || nrow(intervals) == 0) {
        tags$p("No interval checks yet.")
      } else {
        tags$div(
          class = "accordion-group",
          map(seq_len(nrow(intervals)), ~ interval_check_accordion(intervals[.x, ]))
        )
      }
    tagList(
      tags$button(
        class = "accordion",
        `data-current` = dc,
        tags$strong(paste0(.x$nest_id[[1]], ".")),
        paste0(" Species : ", .x$species[[1]])
      ),
      tags$div(
        class = "panel",
        `data-current` = dc,
        tags$ul(
          tags$li(tags$strong("Patch"), ": ", .x$patch_id[[1]]),
          tags$li(tags$strong("Plant species"), ": ", .x$substrate[[1]]),
          tags$li(tags$strong("Height"), ": ", as.character(.x$height[[1]])),
          tags$li(tags$strong("Location description"), ": ", .x$location_description[[1]]),
          tags$li(tags$strong("Discovered on"), ": ", as.character(.x$discovery_date[[1]])),
          tags$li(tags$strong("Last checked on"), ": ", as.character(.x$last_check[[1]])),
          tags$li(tags$strong("Current status"), ": ", .x$last_status[[1]])
        ),
        tags$button(
          type = "button",
          class = "field-popup-btn",
          onclick = paste0("window.fieldNavigateNavPoint('", .x$nest_id[[1]], "')"),
          "Navigate"
        ),
        tags$button(
          type = "button",
          class = "field-popup-btn",
          onclick = paste0("window.fieldViewNest('", .x$nest_id[[1]], "')"),
          "View"
        ),
        tags$button(
          type = "button",
          class = "field-popup-btn",
          onclick = paste0("window.fieldOpenNestModify('", .x$nest_id[[1]], "')"),
          "Modify"
        ),
        tags$div(
          class = "nest-view-detail",
          `data-nest` = .x$nest_id[[1]],
          style = "display:none;",
          interval_accordions
        ),
        tags$div(
          class = "nest-detail-map",
          `data-nest` = .x$nest_id[[1]]
        )
      )
    )
  }

nest_toggle <-
  function(id, label) {
    tags$label(
      class = "field-toggle",
      tags$input(
        type = "checkbox",
        id = id,
        class = "field-toggle-input",
        checked = NA
      ),
      tags$span(
        class = "field-toggle-track",
        tags$span(class = "field-toggle-thumb")
      ),
      tags$span(class = "field-toggle-label", label)
    )
  }

nest_panels <-
  tryCatch({
    field_nests <-
      here::here("data/field_data.rds") %>%
      read_rds() %>%
      pluck("nests")

    current_nest_ids <-
      tryCatch(
        here::here("data/current_nests.rds") %>%
          read_rds() %>%
          pull(nest_id),
        error = function(e) NULL
      )

    field_nests <-
      field_nests %>%
      filter(nest_id != "N031")

    # Keep each nest's interval rows as a per-nest list-column so nest_accordion
    # can render the full View detail, while still summarizing last_check /
    # last_status for the collapsed row.

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

    nest_list <-
      nests_start %>%
      split(.$nest_id)

    test_patch_labels <-
      c(
        test_snedgen_park = "Test: Snedgen Park",
        test_long_branch = "Test: Long branch"
      )

    patch_list <-
      nests_start %>%
      split(.$patch_id)

    patch_list[setdiff(names(test_patch_labels), names(patch_list))] <-
      list(nests_start[0, ])

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
        nest_toggle("nestCurrentToggle", "Current nests")
      ),
      tags$div(
        id = "nest-view-all",
        class = "nest-view",
        style = "display: none;",
        tags$div(
          class = "accordion-group",
          map(nest_list, nest_accordion)
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
                    class = "accordion-group nest-accordion-group",
                    map(
                      split(.x, .x$nest_id),
                      nest_accordion
                    )
                  )
                )
              )
            }
          )
        )
      )
    )
  },
  error = function(e) tags$p("Nest information is currently unavailable.")
  )
