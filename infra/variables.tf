variable "location" {
  description = "Région Azure (seules ces régions sont autorisées par l'abonnement)."
  type        = string
  default     = "polandcentral"

  validation {
    condition = contains(
      ["italynorth", "polandcentral", "austriaeast", "germanywestcentral", "francecentral"],
      var.location
    )
    error_message = "La région doit être l'une de : italynorth, polandcentral, austriaeast, germanywestcentral, francecentral."
  }
}

variable "resource_group_name" {
  description = "Nom du groupe de ressources."
  type        = string
  default     = "rg-shoplite"
}

variable "vm_size" {
  description = "Taille des machines (2 vCPU, 4 Go). Quota régional : 6 vCPU, soit 3 machines max."
  type        = string
  default     = "Standard_B2als_v2"
}

variable "worker_count" {
  description = "Nombre de nœuds de travail (1 ou 2, pour rester dans le quota de 6 vCPU)."
  type        = number
  default     = 1

  validation {
    condition     = var.worker_count >= 1 && var.worker_count <= 2
    error_message = "worker_count doit être compris entre 1 et 2."
  }
}

variable "admin_username" {
  description = "Utilisateur administrateur des machines."
  type        = string
  default     = "azureuser"
}

variable "ssh_public_key_path" {
  description = "Chemin de la clé publique SSH injectée dans les machines."
  type        = string
  default     = "~/.ssh/shoplite.pub"
}

variable "allowed_cidrs" {
  description = "CIDR autorisés pour SSH et l'API Kubernetes. Vide = IP publique détectée automatiquement (/32)."
  type        = list(string)
  default     = []
}

variable "vnet_cidr" {
  description = "Plage d'adresses du réseau virtuel."
  type        = string
  default     = "10.10.0.0/16"
}

variable "subnet_cidr" {
  description = "Plage d'adresses du sous-réseau du cluster."
  type        = string
  default     = "10.10.1.0/24"
}