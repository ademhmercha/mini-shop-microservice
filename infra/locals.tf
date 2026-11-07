# IP publique détectée automatiquement (utilisée si allowed_cidrs est vide).
data "http" "my_ip" {
  url = "https://api.ipify.org"
}

locals {
  my_ip_cidr = "${chomp(data.http.my_ip.response_body)}/32"

  # CIDR effectivement autorisés pour SSH et l'API Kubernetes.
  allowed_cidrs = length(var.allowed_cidrs) > 0 ? var.allowed_cidrs : [local.my_ip_cidr]

  # Tags communs : Ansible s'en sert pour l'inventaire dynamique.
  common_tags = {
    project    = "shoplite"
    cluster    = "shoplite"
    managed_by = "terraform"
  }

  # Machines à créer, avec IP privée fixe.
  # cp-1 : plan de contrôle ; worker-1, worker-2 : nœuds de travail.
  control_plane = {
    "cp-1" = { role = "control-plane", private_ip = "10.10.1.10" }
  }

  workers = {
    for i in range(var.worker_count) :
    "worker-${i + 1}" => { role = "worker", private_ip = "10.10.1.${21 + i}" }
  }

  nodes = merge(local.control_plane, local.workers)
}