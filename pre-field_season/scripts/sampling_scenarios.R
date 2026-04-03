# Trying to figure out (and hopefully reduce) field time

# setup -------------------------------------------------------------------

library(suncalc)
library(tidyverse)

source("pre-field_season/scripts/sampling_scenarios_source.R")

# parameter definitions ---------------------------------------------------

# Parameters and base values:

.n_active_nests     = 16   # How many nests will you check?
.n_active_patches   = 4    # How many patches are the nests in?
.n_search_patches   = 2    # How many patches would you like to search?
.search_time        = 60   # How many patches would you like to search?
.n_predator_patches = 4    # How many patches are you monitoring?
.patch_transit      = 20   # Transit time between patches in minutes
.board_time         = 5    # Time taken to check a cover board
.n_boards_checked   = 2    # Number of cover boards checked per patch
.point_count_time   = 10   # Time taken to conduct a point count
.board_transit      = 5    # Transit time between cover boards
.check_time         = 5    # Minutes per check & concealment photo
.nest_transit       = 5    # How long does it take to move between nests?

# potentially final version -----------------------------------------------

## scenario 1: lots of nests ----------------------------------------------
# * Callie 1 day/week
# * Mama Snedgen 1 day/week
# * Brian 1 day/week and tough Sundays
# * Solo 3 days per week

### CS/MS days ------------------------------------------------------------
# * T conducts the point count
# * T checks one board, CS/MS checks the other
# * T checks half the nests, CS/MS checks the other half
# * T searches patches with CS/MS (search time cut in half)

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 8,
  .n_active_patches = 4,
  .n_boards_checked = 1,
  .search_time = 30,
  .n_search_patches = 3
)

### Brian days ------------------------------------------------------------

# T only does nest searching:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 0,
  .n_active_patches = 0,
  .n_boards_checked = 0,
  .search_time = 60,
  .n_search_patches = 6
)

# B does predator counts, nest checks, and nest searching:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_boards_checked = 2,
  .search_time = 60,
  .n_search_patches = 1
)

# Tough Sundays (missed two days of nest sampling), T & B:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_boards_checked = 2,
  .search_time = 60,
  .n_search_patches = 0
)

# Really tough Sundays (missed two days of sampling & searching), T & B:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_boards_checked = 2,
  .search_time = 60,
  .n_search_patches = 1
)

### Solo days -------------------------------------------------------------

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_boards_checked = 2,
  .n_search_patches = 0
)



## scenario 2: fewer nests ------------------------------------------------
# * Callie 1 day/week
# * Mama Snedgen 1 day/week
# * Brian 1 day/week and tough Sundays
# * Solo 3 days per week

### CS/MS days ------------------------------------------------------------
# * T conducts the point count
# * T checks one board, CS/MS checks the other
# * T checks half the nests, CS/MS checks the other half
# * T searches patches with CS/MS (search time cut in half)

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 4,
  .n_active_patches = 4,
  .n_boards_checked = 1,
  .search_time = 30,
  .n_search_patches = 4
)

### Brian days ------------------------------------------------------------

# T only does nest searching:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 0,
  .n_active_patches = 0,
  .n_boards_checked = 0,
  .search_time = 60,
  .n_search_patches = 5
)

# B does predator counts, nest checks, and nest searching:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 8,
  .n_active_patches = 4,
  .n_boards_checked = 2,
  .search_time = 60,
  .n_search_patches = 1
)

### solo days -------------------------------------------------------------

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 8,
  .n_active_patches = 4,
  .n_boards_checked = 2,
  .search_time = 0,
  .n_search_patches = 0
)

## solo Tara --------------------------------------------------------------

# No active nests, just searching (likely scenario for the start of the season,
# this would be spread over 4 days):

get_daily_schedule(
  "2026-05-10", 
  .n_active_nests = 0,
  .n_search_patches = 4
)

# ... but if you find a just few nests during that week you would have to reduce
# the number of patches searched to end at the same time:

get_daily_schedule(
  "2026-05-10", 
  .n_active_nests = 5,
  .n_active_patches = 3,
  .n_search_patches = 3
)

# Monitoring and searching in one day (with lots of nests, potential scenario
# for 1 June if you end up fully solo):

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 2
)

# Lots of active nests, so you decide to only search one patch (likely scenario
# for 1 June):

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 1
)

# A typical Sunday scenario: Missed a day of monitoring because of the rain,
# have to monitor a patches (but no searching):

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 0
)

# A Sunday in which you missed a patch search and got rained out of a monitoring
# day:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 1
)

# Note that the amount of time goes down if the nests are spread among fewer
# patches:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 3,
  .n_search_patches = 0
)

# Option: Cap the number of nests per patch at any one time to 3:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 12,
  .n_active_patches = 3,
  .n_search_patches = 2
)

#  Of course, a more likely number of nests (but still optimistic):

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 8,
  .n_active_patches = 3,
  .n_search_patches = 2
)

# Verdict: This plan may be unfeasible unless the nest count is reduced.

# Note: There is some flexibility here. You could choose the patches to search
# based on days that you have less nests or nests distributed into few patches.
# That would help.

# Callie/GMU interns help 1 day/week --------------------------------------
# Helper: Point counts, cover boards, and nest checks

## Day with help ----------------------------------------------------------

# You:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 0,
  .n_active_patches = 0,
  .n_predator_patches = 0,
  .n_search_patches = 5
)

# Helper:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 0
)

## Days without help (5) --------------------------------------------------

# 2 days:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 2
)

# 3 days:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 1
)

# Verdict: 2 days per week with a potential end time of 16:10 may be too
# challenging.

# Callie/GMU interns help 2 days/week -------------------------------------
# Helper: Point counts, cover boards, and nest checks

## Days with help (2) -----------------------------------------------------

# You:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 0,
  .n_active_patches = 0,
  .n_predator_patches = 0,
  .n_search_patches = 5
)

# Helper:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 0
)

## Days without help (4) --------------------------------------------------

# 2 days:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 1
)

# 2 days:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 0
)

# Verdict: Pretty reasonable here!

# Callie/GMU interns help 3 days/week -------------------------------------
# Helper: Point counts, cover boards, and nest checks

## Days with help (3) -----------------------------------------------------

# You:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 0,
  .n_active_patches = 0,
  .n_predator_patches = 0,
  .n_search_patches = 5
)

# Helper:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 0
)

## Days without help (3) --------------------------------------------------

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 0
)

# Verdict: Super doable!

# Note: This is now 15 patch searches/week, which can help you stay ahead

# I help 1 day/week -------------------------------------------------------
# Me: Point counts, cover boards, nest checks, nest searching

## Day with help ----------------------------------------------------------

# You:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 0,
  .n_active_patches = 0,
  .n_predator_patches = 0,
  .n_search_patches = 6
)

# Me:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 1
)

## Days without help (5) --------------------------------------------------

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 1
)

# Verdict: Very doable!

# I help 1 day/week, Callie/GMU intern help 1 day/week --------------------
# Helper: Point counts, cover boards, nest checks, nest searching
# Me: Point counts, cover boards, nest checks, nest searching

## Day with helper 1 ------------------------------------------------------

# You:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 0,
  .n_active_patches = 0,
  .n_predator_patches = 0,
  .n_search_patches = 5
)

# Helper:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 0
)

## Day with me ------------------------------------------------------------

# You:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 0,
  .n_active_patches = 0,
  .n_predator_patches = 0,
  .n_search_patches = 5
)

# Me:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 1
)

## Days without help (4) --------------------------------------------------

# 1 day:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 1
)

# 3 days:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 0
)

# Verdict: Great!

# I help 1 day/week, Callie/GMU intern help 2 days/week -------------------
# Helper: Point counts, cover boards, nest checks, nest searching
# Me: Point counts, cover boards, nest checks, nest searching

## Days with helper 1 (2) -------------------------------------------------

# You:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 0,
  .n_active_patches = 0,
  .n_predator_patches = 0,
  .n_search_patches = 5
)

# Helper:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 0
)

## Day with me ------------------------------------------------------------

# You:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 0,
  .n_active_patches = 0,
  .n_predator_patches = 0,
  .n_search_patches = 5
)

# Me:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 0
)

## Days without help (3) --------------------------------------------------

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 0
)

# Verdict: Super great! You can ahead on nests and end very early each day.

# trying to figure out mama snedgen ---------------------------------------

# Issue: She (or anyone without a formal internship) cannot be left in a patch
# by herself even with permission to go on campus.

# My assumption is that:
# * Point count time will be the same (can't rustle around in the patch while
#   the count is occurring).
# * Cover board checks can be divided in half (you check one board, she checks
#   the other).
# * Transit time between patches will be the same.
# * Nest checks can be divided in half (per patch).

# So, for a day with 16 nests across 4 patches, this might be:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 8,
  .n_active_patches = 4,
  .n_boards_checked = 1,
  .n_search_patches = 2
)

# That's a vast improvement over:

get_daily_schedule(
  "2026-06-01", 
  .n_active_nests = 16,
  .n_active_patches = 4,
  .n_search_patches = 2
)

# The take-home message is that mama snedgen doesn't take away the need for
# official help. That being said, she makes things much more doable for the
# scenarios in which:
# * The solo Tara scenario is the best we can do
# * Callie/GMU interns help 1 day/week
# * The 14:50 day if I help 1 day/week and you don't have additional help that
#   week.
