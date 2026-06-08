// I've extended and made our accordion more flexible to account for our two 
// different use cases -- all closed by default, or open to today for the daily
// scheduling app.

// Event listener ensures that all content has been loaded onto the webpage 
// before initiating a search for accordion buttons or panels:

document.addEventListener("DOMContentLoaded", function() {
  
  // Find each accordion group on the page. A page can have one or more
  // accordion group:

  var groups = document.querySelectorAll(".accordion-group");
  
  // Looping through each accordion group separately allows each group to have
  // different behaviors:
  
  groups.forEach(function(group) {
    
    // Get all of the accordion buttons in a group:
    
    var acc = group.getElementsByClassName("accordion");
    
    // Define each accordion button:

    for (var i = 0; i < acc.length; i++) {
      
      // A button can be active or inactive. Make sure all buttons are inactive
      // by default:
      
      acc[i].classList.remove("active");
      
      // Find the panel associated with the accordion button. This assumes that
      // the panel is the next element after the button:

      var panel = acc[i].nextElementSibling;
      
      // Panels are closed by default:

      if (panel && panel.classList.contains("panel")) {
        panel.style.display = "none";
      }
      
      // Listen for inputs, such as mouse clicks or finger taps, to activate a
      // panel:

      acc[i].addEventListener("click", function() {
        this.classList.toggle("active");
        
        // Find the panel after the clicked button:

        var panel = this.nextElementSibling;
        
        // Stop if there is no panel after the accordion button:

        if (!panel || !panel.classList.contains("panel")) return;
        
        // Clicking a button for an open panel closes it:

        if (panel.style.display === "block") {
          panel.style.display = "none";
          
        // Clicking a button for a closed panel opens it:
          
        } else {
          panel.style.display = "block";
        }
      });
    }
    
    // Optional behavior for an accordion associated with a daily schedule:
    // open today's date by default.

    if (group.dataset.openToday === "true") {
      openTodayPanel(group);
    }
  });
});

// Get the local date in ISO 8601 format, while accounting for local time zone.
// This returns a string like "2026-06-08".

function getLocalDateString() {
  
  // Get date information:
  
  var today = new Date();
  var year = today.getFullYear();
  var month = String(today.getMonth() + 1).padStart(2, "0");
  var day = String(today.getDate()).padStart(2, "0");
  
  // Combine year, month, and day:
  
  return year + "-" + month + "-" + day;
}

// Open the panel associated with today's date.

function openTodayPanel(container) {
  
  // Variable definitions:
  
  var acc = container.getElementsByClassName("accordion");
  var today = getLocalDateString();
  
  // Loop through the accordion buttons in this group and find the first one
  // whose data-date attribute matches today's date:

  for (var i = 0; i < acc.length; i++) {
    
    // If the button date is today:
    
    if (acc[i].dataset.date === today) {
      
      // Define the button as active:
      
      acc[i].classList.add("active");
      
      // Define the panel for today:
      
      var panel = acc[i].nextElementSibling;
      
      // Open the panel:

      if (panel && panel.classList.contains("panel")) {
        panel.style.display = "block";
      }
      
      // Stop after the first matching panel:

      break;
    }
  }
}