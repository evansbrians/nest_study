// Flexible accordion script.
// Supports:
// 1) all panels closed by default
// 2) optional opening of today's panel for schedule accordions

document.addEventListener("DOMContentLoaded", function() {
  
  // Find each accordion group on the page.
  // A page can have one or more accordion groups.

  var groups = document.querySelectorAll(".accordion-group");
  
  // Set up each accordion group separately.

  groups.forEach(function(group) {
    setupAccordionGroup(group);

    // Optional behavior:
    // If the group has data-open-today="true", open today's panel.

    if (group.dataset.openToday === "true") {
      openTodayPanel(group);
    }
  });
});


function setupAccordionGroup(group) {
  
  // Get only the direct accordion buttons in this group.
  // This is important for nested accordions, because it prevents
  // nested nest-level accordions from being initialized as if they
  // were top-level patch accordions.

  var acc = group.querySelectorAll(":scope > .accordion");

  // Set up each accordion button.

  for (var i = 0; i < acc.length; i++) {
    
    // Make sure the button starts inactive.

    acc[i].classList.remove("active");
    
    // Find the panel immediately after the button.

    var panel = acc[i].nextElementSibling;
    
    // Close panels by default.

    if (panel && panel.classList.contains("panel")) {
      panel.style.display = "none";
    }
    
    // Add click/tap behavior.

    acc[i].addEventListener("click", function() {
      this.classList.toggle("active");
      
      // Find the panel after the clicked button.

      var panel = this.nextElementSibling;
      
      // Stop if the expected panel is not present.

      if (!panel || !panel.classList.contains("panel")) return;
      
      // Toggle open/closed.

      if (panel.style.display === "block") {
        panel.style.display = "none";
      } else {
        panel.style.display = "block";
      }
    });
  }
}


// Get the local date in ISO 8601 format.
// Example: "2026-06-08"

function getLocalDateString() {
  var today = new Date();
  var year = today.getFullYear();
  var month = String(today.getMonth() + 1).padStart(2, "0");
  var day = String(today.getDate()).padStart(2, "0");

  return year + "-" + month + "-" + day;
}


// Open the panel associated with today's date.
// This requires accordion buttons to have data-date="YYYY-MM-DD".

function openTodayPanel(group) {
  
  // Again, use only direct accordion children of this group.

  var acc = group.querySelectorAll(":scope > .accordion");
  var today = getLocalDateString();
  
  for (var i = 0; i < acc.length; i++) {
    
    if (acc[i].dataset.date === today) {
      acc[i].classList.add("active");
      
      var panel = acc[i].nextElementSibling;

      if (panel && panel.classList.contains("panel")) {
        panel.style.display = "block";
      }

      break;
    }
  }
}