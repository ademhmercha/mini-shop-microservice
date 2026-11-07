# Une IP publique statique (SKU Standard) par machine, sans zone.
resource "azurerm_public_ip" "node" {
  for_each = local.nodes

  name                = "pip-${each.key}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = []
  tags                = local.common_tags
}

# Interface réseau avec transfert IP (nécessaire au réseau des pods).
resource "azurerm_network_interface" "node" {
  for_each = local.nodes

  name                  = "nic-${each.key}"
  location              = azurerm_resource_group.main.location
  resource_group_name   = azurerm_resource_group.main.name
  ip_forwarding_enabled = true
  tags                  = local.common_tags

  ip_configuration {
    name                          = "ipconfig1"
    subnet_id                     = azurerm_subnet.cluster.id
    private_ip_address_allocation = "Static"
    private_ip_address            = each.value.private_ip
    public_ip_address_id          = azurerm_public_ip.node[each.key].id
  }
}

resource "azurerm_linux_virtual_machine" "node" {
  for_each = local.nodes

  name                  = each.key
  computer_name         = each.key
  location              = azurerm_resource_group.main.location
  resource_group_name   = azurerm_resource_group.main.name
  size                  = var.vm_size
  admin_username        = var.admin_username
  network_interface_ids = [azurerm_network_interface.node[each.key].id]

  # Authentification par clé SSH uniquement.
  disable_password_authentication = true

  admin_ssh_key {
    username   = var.admin_username
    public_key = file(pathexpand(var.ssh_public_key_path))
  }

  # Disque système 30 Go en Standard SSD.
  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = 30
  }

  # Ubuntu 24.04 LTS officielle de Canonical (serveur, Gen2).
  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  # Diagnostics de démarrage avec le stockage géré par Azure (bloc vide).
  boot_diagnostics {}

  # Tags lus par l'inventaire dynamique d'Ansible.
  tags = merge(local.common_tags, { role = each.value.role })
}