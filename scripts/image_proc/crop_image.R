
# Iteratively crop images

# setup -------------------------------------------------------------------

# Load required packages:

library(shiny)
library(miniUI)
library(magick)
library(glue)
library(tidyverse)

source("scripts/utils/functions/utility_functions.R")

# usage -------------------------------------------------------------------

# To crop an image from an image stored on your computer:

output <- crop_image_gadget("concealment_photos/IMG_3430.png")

# To crop an image assigned to your global environment:

crop_image_gadget(output, .output_path = "boy_howdy.png")
