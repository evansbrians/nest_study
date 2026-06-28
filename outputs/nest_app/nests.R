library(tidyverse)
library(htmltools)

nest_accordion <-
  function(.x) {
    dc <- if (isTRUE(.x$is_current[[1]])) "true" else "false"
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

    nests_start <-
      field_nests %>%
      filter(nest_id != "N031") %>%
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
      mutate(
        across(
          where(is.character),
          ~ replace_na(.x, "Unknown")
        ),
        is_current =
          if (is.null(current_nest_ids)) TRUE else nest_id %in% current_nest_ids
      )

    nest_list <-
      nests_start %>%
      split(.$nest_id)

    patch_list <-
      nests_start %>%
      split(.$patch_id)

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
              patch_dc <- if (any(.x$is_current)) "true" else "false"
              tagList(
                tags$button(
                  class = "accordion patch-accordion",
                  `data-current` = patch_dc,
                  tags$strong(.y),
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
