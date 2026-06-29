library(tidyverse)

schedule_content <-
  tibble::tribble(
    ~day, ~helper, ~helper_patch_1, ~me_patch_1, ~helper_patch_2, ~me_patch_2,
    "Mon", NA_character_,
    "-", "Search the bramble patch loop;",
    "-", "Search near CB 1 and 2 - carve paths where necessary; Scan the fenceline",
    "Tue", NA_character_,
    "Explore the Western section of the patch",
    "Hunt for fledgling WEVIs near the point count spot; Scan the fence line West of CB 4",
    "Between CB 4 and 6 (I've heard some serious cardinal activity there)",
    "Machete-explore between CB 1 and 2",
    "Wed", NA_character_,
    "-", "Large central island; Explore more in the bamboo, heading towards CB 4",
    "-", "Explore the CB 3 outcrop, working towards CB 6; Scan the CB 2 outcrop",
    "Thu", "",
    "-", "Northern section",
    "-", "Inlets along the Northern edge",
    "Fri", NA_character_,
    "-", "Focus on the Western section (CB 6 end)",
    "-", "Continue to create distributaries along the main paths; Investigate more near trailcam_1",
    "Sat", NA_character_,
    "CB 5 to 4", "Bamboo patch area and CB 4 to 5",
    "Continue exploring around the pocket along entrace path",
    "Continue exploring near CB 6 and the edges along the power line alleyway"
  ) %>%
  mutate(
    notes = list(
      c(
        "Check the security of trailcam_2 at coyote. Switch SD cards in sensitivity test cameras (witch_hazel 1 and 2, firehouse 2).",
        "At each nest, take a picture from further away and jot down a brief description of where the picture was taken and how to find the nest.",
        "Take note of which inactive nests might be suitable for artificial eggs."
      ),
      c(
        "At each nest, take a picture from further away and jot down a brief description of where the picture was taken and how to find the nest.",
        "Take note of which inactive nests might be suitable for artificial eggs."
      ),
      c(
        "At each nest, take a picture from further away and jot down a brief description of where the picture was taken and how to find the nest.",
        "Take note of which inactive nests might be suitable for artificial eggs."
      ),
      character(0),
      c(
        "At each nest, take a picture from further away and jot down a brief description of where the picture was taken and how to find the nest.",
        "Only change batteries and SD cards at one trailcam per patch (to avoid future maintenance scheduling woes).",
        "Take note of which inactive nests might be suitable for artificial eggs."
      ),
      c(
        "At each nest, take a picture from further away and jot down a brief description of where the picture was taken and how to find the nest.",
        "Take note of which inactive nests might be suitable for artificial eggs."
      )
    )
  )

write_rds(schedule_content, here::here("data/schedule_content.rds"))
