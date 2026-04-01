
# A code that will help you develop a narrower list of species for your 
# point count data validation.

# setup -------------------------------------------------------------------

library(rebird)
library(tidyverse)

# bird list for Warren County ---------------------------------------------

# This provides a data frame of all birds observed in Warren County.

fro_ro_birds <- 
  
  # Get region code for Front Royal:
  
  ebirdsubregionlist(
    regionType = "subnational2", 
    parentRegionCode = "US-VA"
  ) %>% 
  filter(name == "Warren") %>% 
  pull(code) %>% 
  
  # All birds observed in region:
  
  rebird::ebirdregionspecies() %>% 
  
  # Join with taxonomy:
  
  inner_join(
    rebird::ebirdtaxonomy(cat = "species"),
    by = "speciesCode"
  ) %>% 
  
  # No more PascalCase:
  
  janitor::clean_names() %>% 
  
  # Subset to columns of interest:
  
  select(
    species_code,
    banding_code = banding_codes,
    order,
    family_sci_name,
    family_com_name,
    sci_name,
    com_name
  )

# You might want to remove things like Anatidae from here.
