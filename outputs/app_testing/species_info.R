library(tidyverse)
library(htmltools)

# Helper function to turn a single field into a table row:

species_info_row <-
  function(label, value) {
    if (is.null(value) || length(value) == 0) return(NULL)
    v <- value[[1]]
    if (
      is.null(v) ||
      (length(v) == 1 && is.na(v)) ||
      identical(
        as.character(v), "")
    ) {
      return(NULL)
    }
    tags$tr(
      tags$th(label),
      tags$td(as.character(v)
      )
    )
  }

# Helper function to add general text for a given species

species_info_text <-
  function(heading, value) {
    if (
      is.null(value) ||
      length(value) == 0
    ) return(NULL)
    v <- value[[1]]
    if (
      is.null(v) ||
      (length(v) == 1 && is.na(v)) ||
      identical(
        as.character(v),
        ""
      )
    ) {
      return(NULL)
    }
    tagList(
      tags$h4(heading),
      tags$p(as.character(v))
    )
  }

# This is then what builds the html tables:

species_info_panels <-
  tryCatch(
    tags$div(
      class = "accordion-group",
      read_rds(
        here::here("data/species_info.rds")
      ) %>%
        split(.$alpha_code) %>%
        imap(
          function(.x, .code) {
            tagList(
              tags$button(
                class = "accordion",
                .x$common_name[[1]]
              ),
              tags$div(
                class = "panel",
                tags$p(
                  tags$em(.x$scientific_name[[1]])
                ),
                tags$table(
                  class = "species-table",
                  species_info_row("Brood attempts", .x$brood_attempts),
                  species_info_row("Incubation", .x$incubation),
                  species_info_row("Nestling", .x$nestling),
                  species_info_row("Clutch size", .x$clutch_size),
                  species_info_row("Egg width", .x$egg_width),
                  species_info_row("Egg length", .x$egg_length)
                ),
                species_info_text("Nest description", .x$nest_description),
                species_info_text("Egg description", .x$egg_description)
              )
            )
          })
    ),
    error = function(e) tags$p("Species information is currently unavailable.")
  )
