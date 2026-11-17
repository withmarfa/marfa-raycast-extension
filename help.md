### Connect to your Marfa server

1. Find the address where your Marfa server answers, such as `http://127.0.0.1:8602`, and enter it as **Server URL**.
2. Mint a key for Raycast. For a default local installation, run this command on the server's Mac:

   ```sh
   marfa --socket "$HOME/marfa-server/data/control/marfa.sock" keys create \
     --label raycast --source raycast \
     --type-permission '*=write' --metadata-permission '*=write' --edge-permission '*=write' \
     --permission items.purge
   ```

   For a remote server, use `marfa keys create` with a credential that holds `keys.mint` and can grant the requested access.

3. Copy the first line of output into **API Key**.

The key decides what the extension can do. When it lacks a permission, the extension names the one that is missing.
