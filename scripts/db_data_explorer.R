
# setup --------------------------------------------------------------------

library(DBI)
library(RSQLite)
library(dbplyr)
library(tidyverse)

source("scripts/utils/functions/db_functions.R")

# connection ---------------------------------------------------------------

# Open a connection to the nest_study database:

con <- connect_nest_db()

# Note: To list tables in the DB use:

dbListTables(con)

# nest queries -------------------------------------------------------------

# Basic nest query:

nest_query()

# Get the nests that are current:

get_current_nests()

# Want to work with it as a tibble?

get_current_nests() %>% 
  collect()

# Discovery and interval data for a single nest:

get_nest_status(.nest_id = "N119") %>% 
  collect()

# schedule -----------------------------------------------------------------

schedule(.week = 9)

# verification -------------------------------------------------------------

# Nests discovered on or after a date:

nests_since(
  .date = today() - 1
)

# Interval checks recorded on or after a date:

checks_since(
  .date = today() - 1
)

# Row counts for the core tables (a check to see if new data were added):

data_counts()

# End connection each time you're done! -----------------------------------

dbDisconnect(con)
