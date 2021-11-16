provider "docker" {
  host = "tcp://localhost:2376"

  registry_auth {
    address  = "registry-1.docker.io"
    username = var.docker_hub_username
    password = var.docker_hub_access_token
  }
}

data "docker_registry_image" "quay" {
  name = "jafudi/mumbling-mole:latest"

  build {
    context = path.cwd
  }
}
