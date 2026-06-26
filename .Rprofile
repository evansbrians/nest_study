
# Authorize Google Sheets and Google Drive via a key:

gs_key <-
  if (nzchar(Sys.getenv("GOOGLE_SHEETS_KEY"))) {
    Sys.getenv("GOOGLE_SHEETS_KEY")
  } else if (file.exists(".secrets/service_account.json")) {
    ".secrets/service_account.json"
  } else {
    ""
  }

if (nzchar(gs_key)) {
  googlesheets4::gs4_auth(path = gs_key)
  googledrive::drive_auth(path = gs_key)
}

# When sf loads, we can ensure that all data within a simple feature collection
# is viewed as a tibble rather than a data frame:

setHook(
  packageEvent("sf", "attach"),
  function(...) {
    
    # Access the sf namespace:
    
    ns <- asNamespace("sf")
    
    # Unlock the binding for the core function used to construct sf objects:
    
    unlockBinding("st_sf", ns)
    
    # Capture the original constructor:
    
    orig_st_sf <- ns$st_sf
    
    # Overwrite the constructor to automatically append tibble classes:
    
    assign("st_sf", function(...) {
      obj <- orig_st_sf(...)
      
      # If it's not a tibble ...
      
      if (!inherits(obj, "tbl_df")) {
        
        # ... make it a tibble!
        
        class(obj) <- 
          c(
            "sf",
            "tbl_df", 
            "tbl", 
            "data.frame"
          )
      }
      return(obj)
    }, envir = ns)
    
    # Lock the binding:
    
    lockBinding("st_sf", ns)
  }
)

