# Exemple de valeurs (aucun secret). Copiez/adaptez selon vos besoins.
location            = "polandcentral"
resource_group_name = "rg-shoplite"
vm_size             = "Standard_B2als_v2"
worker_count        = 1
admin_username      = "azureuser"
ssh_public_key_path = "~/.ssh/shoplite.pub"

# Vide = votre IP publique est détectée automatiquement.
# Pour la forcer : allowed_cidrs = ["203.0.113.10/32"]
allowed_cidrs = []