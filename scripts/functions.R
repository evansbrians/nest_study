
# universal functions -----------------------------------------------------

# Get names from file paths

set_names_from_path <-
  function(.path) {
    set_names(
      .path,
      basename(.path) %>% 
      str_remove("\\.[^.]+$")
    )
  }


