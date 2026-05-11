

# patch counts ------------------------------------------------------------

# Define patches and their optimal order:

patches <- 
  c(
    "coyote",
    "banding",
    "firehouse",
    "forest_a",
    "forest_geo",
    "witch_hazel",
    # "leech",
    "grassland_a",
    "grassland_b_fence",
    "grassland_b",
    "forest_b"
  )

# Sequential patches:

patch_counts_sequential <- 
  sampling_start %>% 
  
  # Remove Sundays:
  
  filter(day != "Sun") %>% 
  
  # Repeat each day 4 times:
  
  uncount(4) %>% 
  
  # Assign patches to days:
  
  mutate(
    patch_count = 
      rep_len(
        patches, 
        n()
      )
  ) %>% 
  
  # Add helpers:
  
  mutate(
    helper = 
      case_when(
        day == "Tue" & week %in% 8:10 ~ "-",
        day == "Tue" ~ "Callie",
        day == "Thu" ~ "Mama S",
        day == "Sat" ~ "Brian",
        .default = "-"
      ),
    .after = day
  )

# Randomize patch order on a given day:

patch_counts_randomized <-
  patch_counts_sequential %>% 
  slice_sample(
    n = 4,
    by = "date"
  )

# patch searches ----------------------------------------------------------

# Sequential version:

patch_search_sequential <-
  patch_counts_sequential %>% 
  mutate(
    patch_search =
      case_when(
        helper == "-" ~ "-",
        helper == "Brian" ~ NA_character_,
        
        # When you are sampling with Callie and your mom, you will search the
        # last three patches sampled:
        
        patch_count != last(patch_count) ~ patch_count
      ),
    .by = c(week, helper)
  ) %>% 
  
  # When you are sampling with me, all remaining patches will be searched:
  
  mutate(
    patch_search =
      case_when(
        helper == "Brian" & 
          patch_count == last(patch_count) ~
          str_flatten(
            patches[!patches %in% patch_search], 
            collapse = ", "
          ),
        .default = patch_search
      ),
    .by = week
  ) %>% 
  
  # Flatten the counts and searches then remove duplicates:
  
  mutate(
    patch_count = 
      str_flatten(patch_count, collapse = " \u2192 "),
    patch_search = 
      patch_search %>% 
      unique() %>% 
      str_flatten(
        collapse = ", ", 
        na.rm = TRUE
      ),
    .by = date
  ) %>% 
  distinct() %>% 
  select(helper, patch_count: patch_search)

# Random version:

patch_counts_randomized %>% 
  mutate(
    patch_search =
      case_when(
        helper == "-" ~ "-",
        helper == "Brian" ~ NA_character_,
        
        # When you are sampling with Callie and your mom, you will search the
        # last three patches sampled:
        
        patch_count != last(patch_count) ~ patch_count
      ),
    .by = c(week, helper)
  ) %>% 

  # When you are sampling with me, all remaining patches will be searched:
  
  mutate(
    patch_search =
      case_when(
        helper == "Brian" & 
          patch_count == last(patch_count) ~
          str_flatten(
            patches[!patches %in% patch_search], 
            collapse = ", "
          ),
        .default = patch_search
      ),
    .by = week
  ) %>% 
  
  # Flatten the counts and searches then remove duplicates:
  
  mutate(
    patch_count = 
      str_flatten(patch_count, collapse = " \u2192 "),
    patch_search = 
      patch_search %>% 
      unique() %>% 
      str_flatten(
        collapse = ", ", 
        na.rm = TRUE
      ),
    .by = date
  ) %>% 
  distinct() %>% 
  select(week, helper, patch_count: patch_search) %>% 
  print(n = 30)

# add helpers -------------------------------------------------------------

patch_counts %>% 
  mutate(
    patch_search =
      case_when(
        helper == "-" ~ "-",
        
        # As the first of search of the week, you'll search the last three
        # patches sampled when you are sampling with Callie:
        
        helper == "Callie" &
          patch_count != first(patch_count[helper == "Callie"]) ~ patch_count,
        
        # When you're sampling with your mom, you'll search the last three
        # patches sampled excluding anything you searched with Callie:
        
        helper == "Mama" &
          !patch_count %in% patch_count[helper == "Callie"] &
          patch_count != first(patch_count[helper == "Mama"]) ~ patch_count,
        
        helper == "Brian" & 
          !patch_count %in% patch_count[str_detect(helper, "^[CM]")] ~
          patch_count,
        .default = "-"
      ),
    .by = week
  ) %>% 
  filter(helper != "-") %>% 
  # filter(helper %in% c("Callie", "Mama")) %>% 
  summarize(
    patches_searched = length(unique(patch_search)),
    .by = week
  )
# print(n = 40)


patch_counts %>% 
  mutate(
    patch_search =
      case_when(
        
        # As the first of search of the week, you'll search the last three
        # patches sampled when you are sampling with Callie:
        
        helper == "Callie" &
          patch_count != first(patch_count[helper == "Callie"]) ~ patch_count,
        
        # As a starting point, the counted patches will be searched on the days
        # with your mom:
        
        helper == "Mama" ~ patch_count,
        
        # Everything else gets a dash:
        
        .default = "-"
      ),
    patch_search =
      case_when(
        helper == "Mama" & 
          patch_search %in% patch_search[helper == "Callie"] ~ "-",
        helper == "Mama" &
          length(patch_search[patch_search != "-"]) > 3 &
          patch_search == first(patch_search) ~ "howdy",
        .default = patch_search
      ),
    .by = week
  ) %>% 
  filter(
    !helper %in% c("-", "Brian")
  ) %>%
  # summarize(
  #   patches_searched = length(patch_search[patch_search != "-"]),
  #   .by = c(week, helper)
  # ) %>%
  print(n = 40)





if_else(
  helper == "-",
  "-",
  patch_count
)
)


case_when(
  helper == "-" ~ "-",
  
  # As the first of search of the week, you'll search the last three
  # patches sampled when you are sampling with Callie:
  
  helper == "Callie" ~ patch_count,
  
  # When you're sampling with your mom, you'll search the last three
  # patches sampled excluding anything you searched with Callie:
  
  helper == "Mama" ~ patch_count,
  
  # There are weeks in which you 
  
  helper == "Mama" &
    length(patch_count[he])
  
  helper == "Brian" & 
    !patch_count %in% patch_count[str_detect(helper, "^[CM]")] ~
    str_flatten(patches[]),
  .default = "-"
),
.by = week
)

mutate(
  count_patch = 
    str_flatten(patch, collapse = " \u2192 "),
  .by = date,
  .keep = "unused"
)


# old ---------------------------------------------------------------------



patch_counts <- 
  seq(
    as_date("2026-05-10"),
    as_date("2026-08-20"),
    by = 1
  ) %>% 
  keep(
    ~ wday(.x) != 1
  ) %>% 
  map_dfr(
    ~ tibble(
      date = 
        rep(.x, 4) %>% 
        as_date
    )
  ) %>% 
  mutate(
    patch = rep(patches, 32)
  ) %>% 
  slice_sample(
    n = 4,
    by = "date"
  ) %>% 
  mutate(
    count_patch = 
      str_flatten(patch, collapse = " \u2192 "),
    .by = date,
    .keep = "unused"
  ) %>% 
  distinct() %>% 
  full_join(
    sampling_start,
    .,
    by = "date"
  ) %>% 
  arrange(date) %>% 
  mutate(
    across(
      matches("patch"),
      ~ replace_na(.x, "-")
    )
  )
