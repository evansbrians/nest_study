// Simple script for toggling between all nests and nests of a given patch

document.addEventListener("DOMContentLoaded", function() {
  var buttons = document.querySelectorAll(".nest-view-button");
  var views = document.querySelectorAll(".nest-view");

  buttons.forEach(function(button) {
    button.addEventListener("click", function() {
      var selectedView = this.dataset.view;

      // Set active button:
      
      buttons.forEach(function(btn) {
        btn.classList.remove("active");
      });

      this.classList.add("active");

      // Show selected view and hide others:
      
      views.forEach(function(view) {
        view.style.display = "none";
      });

      var target = document.getElementById("nest-view-" + selectedView);

      if (target) {
        target.style.display = "block";
      }
    });
  });
});