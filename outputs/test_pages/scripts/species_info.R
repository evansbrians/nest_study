
# Life history information

# set-up ------------------------------------------------------------------

library(tidyverse)

# Read in species list from the nest monitoring sheet and add in scientific
# names:

species <- 
  googlesheets4::read_sheet(
    file.path(
      "https://docs.google.com/spreadsheets/d",
      "1iosPhbwDOVhIM4EkaeexnX0kRLsBqZKEuCbCsxFyMPs"
    ),
    sheet = "species_engine",
    col_names = c("common_name", "alpha_code")
  ) %>% 
  mutate(
    common_name = 
      str_to_title(common_name) %>% 
      str_replace(
        "\\-[A-Z]", 
        str_to_lower(
          str_extract(., "\\-[A-Z]")
        )
      )
  ) %>% 
  inner_join(
    googlesheets4::read_sheet(
      file.path(
        "https://docs.google.com/spreadsheets/d",
        "1UhSvMqwGYMTpQFYyjrDI2xKxvZQVMSVRXHtaH10y_ss"
      )
    ) %>% 
      janitor::clean_names() %>% 
      select(common_name:scientific_name),
    by = "common_name"
  ) %>% 
  arrange(common_name)

# scrape all about birds --------------------------------------------------

species_info <- 
  species %>% 
  pull(common_name) %>% 
  map_dfr(
    \(.x) {
      html_string <- 
        .x %>% 
        str_replace_all(" ", "_") %>% 
        file.path(
          "https://www.allaboutbirds.org/guide",
          .,
          "lifehistory"
        ) %>% 
        httr::GET() %>% 
        XML::htmlParse() %>% 
        as("character")
      
      species %>% 
        filter(common_name == .x) %>% 
        mutate(
          nest_description =
            html_string %>%
            str_extract(
              "(\\r\\n<h3>)?Nest Description</h3>\n<p>(\\n|.)*</p>(\\r)?\\n<h3>"
            ),
          nest_facts =
            html_string %>% 
            str_extract(
              "(\\r\\n<h3>)?Nesting Facts</h3>(\n.*)*(\\r)?(\n.*)*</table>"
            ) %>% 
            str_remove(
              "(\\r\\n<h3>)?Nesting Facts</h3>\n<div><table class=\"callout\"><tbody>"
            ),
        ) %>% 
        separate_wider_delim(
          nest_facts,
          "\n<tr>",
          names = 
            c(
              NA, 
              "clutch_size", 
              "brood_attempts", 
              "egg_length", 
              "egg_width", 
              "incubation", 
              "nestling", 
              "egg_description", 
              NA
            )
        ) %>% 
        mutate(
          across(
            nest_description:egg_description,
            ~ str_remove_all(
              .x, 
              "\\r|</?h3>|Nest Description|\\n|</?[a-z]*>|[A-Za-z ]*:"
            )
          )
        )
    }
  )

# write to file -----------------------------------------------------------

species_info %>% 
  write_rds("data/species_info.rds")
