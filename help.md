### Connect to your Marfa server

1. Find the address where your Marfa server answers, such as `http://127.0.0.1:8602`, and enter it as **Server URL**.
2. Mint a key for Raycast with the `marfa` command line:

   ```sh
   marfa keys create --label raycast --source raycast \
     --type-permission '*=write' --metadata-permission '*=write' --edge-permission '*=write' \
     --permission items.purge
   ```

3. Enter the key as **API Key**.

The key decides what the extension can do. When it lacks a permission, the extension names the one that is missing.
