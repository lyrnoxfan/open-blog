pluginManagement {
    repositories {
        maven { url = uri("http://127.0.0.1:18999/plugins/") }
        maven { url = uri("http://127.0.0.1:18999/google/") }
        maven { url = uri("http://127.0.0.1:18999/central/") }
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven { url = uri("http://127.0.0.1:18999/google/") }
        maven { url = uri("http://127.0.0.1:18999/central/") }
    }
}
rootProject.name = "Blog"
include(":app")
