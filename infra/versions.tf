# Versions figées de Terraform et des providers, et backend distant.
terraform {
  required_version = ">= 1.9"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    # Sert uniquement à détecter l'adresse IP publique de l'utilisateur.
    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }
  }

  # État distant (existant) dans un compte de stockage Azure.
  backend "azurerm" {
    resource_group_name  = "rg-gar-tfstate"
    storage_account_name = "sttfstategar10137"
    container_name       = "tfstate"
    key                  = "shoplite.tfstate"
  }
}

# L'ID d'abonnement n'est pas écrit ici : le provider lit la variable
# d'environnement ARM_SUBSCRIPTION_ID.
provider "azurerm" {
  features {}
}