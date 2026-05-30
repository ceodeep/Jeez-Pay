#!/usr/bin/env bash
set -e

cd ~/Jeez-Pay/admin-dashboard

echo "Building admin dashboard..."
npm run build

echo "Publishing to /var/www/jeezpay-admin..."
sudo rsync -av --delete dist/ /var/www/jeezpay-admin/
sudo chown -R www-data:www-data /var/www/jeezpay-admin

echo "Done. Admin dashboard updated."
