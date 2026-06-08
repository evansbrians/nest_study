// Flexible accordion script!

document.addEventListener("DOMContentLoaded", function() {
  var groups = document.querySelectorAll(".accordion-group");

  groups.forEach(function(group) {
    setupAccordionGroup(group);

    if (group.dataset.openToday === "true") {
      openTodayPanel(group);
    }
  });
});

function setupAccordionGroup(group) {
  
  // Only get accordion buttons that are direct children of this group.
  // This prevents nested accordions from receiving duplicate click handlers.
  
  var acc = group.querySelectorAll(":scope > .accordion");

  for (var i = 0; i < acc.length; i++) {
    acc[i].classList.remove("active");

    var panel = acc[i].nextElementSibling;

    if (panel && panel.classList.contains("panel")) {
      panel.style.display = "none";
    }

    acc[i].addEventListener("click", function() {
      this.classList.toggle("active");

      var panel = this.nextElementSibling;

      if (!panel || !panel.classList.contains("panel")) return;

      if (panel.style.display === "block") {
        panel.style.display = "none";
      } else {
        panel.style.display = "block";
      }
    });
  }
}

function getLocalDateString() {
  var today = new Date();
  var year = today.getFullYear();
  var month = String(today.getMonth() + 1).padStart(2, "0");
  var day = String(today.getDate()).padStart(2, "0");

  return year + "-" + month + "-" + day;
}

function openTodayPanel(group) {
  
  // Only look at direct children of this group:
  
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