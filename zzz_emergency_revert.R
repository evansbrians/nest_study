repo <- "/Volumes/ssd980/gits/nest_study"
system(paste("rm -f", file.path(repo, ".git/index.lock")))
cat("== reset ==\n")
cat(system2("git", c("-C", repo, "reset", "--hard", "67ad1a9"), stdout=TRUE, stderr=TRUE), sep="\n")
cat("\n== push ==\n")
cat(system2("git", c("-C", repo, "push", "--force", "origin", "main"), stdout=TRUE, stderr=TRUE), sep="\n")
cat("\n== head ==\n")
cat(system2("git", c("-C", repo, "log", "-1", "--pretty=%h %ad %s", "--date=iso"), stdout=TRUE, stderr=TRUE), sep="\n")
cat("\nDONE_EMERGENCY_REVERT_67ad1a9\n")
