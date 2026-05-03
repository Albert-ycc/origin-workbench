package main

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

var setupCmd = &cobra.Command{
	Use:   "setup",
	Short: "Configure the CLI, authenticate, and start the daemon",
	Long: `Configures the CLI to connect to the local Origin backend, then
authenticates via browser and starts the agent daemon.

If a configuration already exists, you will be prompted before overwriting.

This fork does not support the upstream Multica Cloud setup path. Use
'multica setup self-host' for the local backend.

Use --profile to create an isolated configuration for a separate environment:
  multica setup self-host --profile staging --server-url https://api-staging.co`,
	RunE: runSetupSelfHost,
}

var setupCloudCmd = &cobra.Command{
	Use:   "cloud",
	Short: "Disabled in the Origin fork",
	Long:  `Origin is local-only. The upstream Multica Cloud setup path is disabled in this fork.`,
	RunE:  runSetupCloud,
}

var setupSelfHostCmd = &cobra.Command{
	Use:   "self-host",
	Short: "Configure the CLI for a local Origin backend",
	Long: `Configures the CLI to connect to a local Origin backend.

By default, connects to http://localhost:8080 (backend) and http://localhost:3000
(desktop/dev browser compatibility URL). Use --server-url and --app-url to
specify a custom local/LAN backend.

If you run this command from a different machine than the server, also pass
--callback-host <FQDN-or-IP-the-browser-can-reach-back-to-this-machine-on> so
the OAuth login flow can return the token to the CLI.

Examples:
  multica setup self-host
  multica setup self-host --server-url https://api.internal.co --app-url https://app.internal.co
  multica setup self-host --port 9090 --frontend-port 4000`,
	RunE: runSetupSelfHost,
}

func init() {
	setupSelfHostCmd.Flags().String("server-url", "", "Backend server URL (e.g. http://localhost:8080)")
	setupSelfHostCmd.Flags().String("app-url", "", "Desktop/dev app URL used for browser auth compatibility")
	setupSelfHostCmd.Flags().Int("port", 8080, "Backend server port (used when --server-url is not set)")
	setupSelfHostCmd.Flags().Int("frontend-port", 3000, "Frontend port (used when --app-url is not set)")
	setupSelfHostCmd.Flags().String(callbackHostFlag, "", "Host the OAuth callback URL points at (auto-detected when empty). Use this for reverse-proxy / FQDN setups.")

	setupCmd.AddCommand(setupCloudCmd)
	setupCmd.AddCommand(setupSelfHostCmd)
}

// printConfigLocation prints the config file path and profile name.
func printConfigLocation(profile string) {
	path, err := cli.CLIConfigPathForProfile(profile)
	if err != nil {
		return
	}
	if profile != "" {
		fmt.Fprintf(os.Stderr, "  profile:    %s\n", profile)
	}
	fmt.Fprintf(os.Stderr, "  config:     %s\n", path)
}

// confirmOverwrite checks for an existing config and prompts the user.
// Returns true if we should proceed, false if the user declined.
func confirmOverwrite(profile string) (bool, error) {
	cfg, err := cli.LoadCLIConfigForProfile(profile)
	if err != nil {
		return true, nil // can't load → treat as no config
	}
	if cfg.ServerURL == "" {
		return true, nil // no server configured → fresh config
	}

	fmt.Fprintln(os.Stderr, "Current configuration:")
	fmt.Fprintf(os.Stderr, "  server_url: %s\n", cfg.ServerURL)
	fmt.Fprintf(os.Stderr, "  app_url:    %s\n", cfg.AppURL)
	if cfg.WorkspaceID != "" {
		fmt.Fprintf(os.Stderr, "  workspace:  %s\n", cfg.WorkspaceID)
	}
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprint(os.Stderr, "This will reset your configuration. Continue? [y/N] ")

	reader := bufio.NewReader(os.Stdin)
	answer, _ := reader.ReadString('\n')
	answer = strings.TrimSpace(strings.ToLower(answer))
	if answer != "y" && answer != "yes" {
		fmt.Fprintln(os.Stderr, "Aborted.")
		return false, nil
	}
	return true, nil
}

func runSetupCloud(cmd *cobra.Command, args []string) error {
	return fmt.Errorf("Origin is local-only; use 'multica setup self-host' against your local backend")
}

func runSetupSelfHost(cmd *cobra.Command, args []string) error {
	profile := resolveProfile(cmd)

	ok, err := confirmOverwrite(profile)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}

	serverURL := stringFlagOrDefault(cmd, "server-url", "")
	appURL := stringFlagOrDefault(cmd, "app-url", "")
	port := intFlagOrDefault(cmd, "port", 8080)
	frontendPort := intFlagOrDefault(cmd, "frontend-port", 3000)
	userProvidedServerURL := serverURL != ""

	// If custom URLs provided, use them; otherwise default to localhost with ports.
	if serverURL == "" {
		serverURL = fmt.Sprintf("http://localhost:%d", port)
	}
	if appURL == "" {
		if userProvidedServerURL && !serverHostIsLocal(serverURL) {
			// We can't guess the frontend URL for a remote server: api.x.co
			// and app.x.co, or an https-fronted deployment, would silently
			// produce a broken login URL. Ask the user instead.
			entered, err := promptAppURL(serverURL)
			if err != nil {
				return err
			}
			if entered == "" {
				return fmt.Errorf("--app-url is required when --server-url points at a remote host (e.g. --app-url https://app.internal.co)")
			}
			appURL = entered
		} else {
			appURL = fmt.Sprintf("http://localhost:%d", frontendPort)
		}
	}

	cfg := cli.CLIConfig{
		ServerURL: serverURL,
		AppURL:    appURL,
	}
	if err := cli.SaveCLIConfigForProfile(cfg, profile); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	fmt.Fprintln(os.Stderr, "Configured for local Origin backend.")
	fmt.Fprintf(os.Stderr, "  server_url: %s\n", cfg.ServerURL)
	fmt.Fprintf(os.Stderr, "  app_url:    %s\n", cfg.AppURL)
	printConfigLocation(profile)

	// Check if the server is reachable.
	if !probeServer(serverURL) {
		fmt.Fprintf(os.Stderr, "\n⚠ Server at %s is not reachable.\n", serverURL)
		fmt.Fprintln(os.Stderr, "  Make sure the server is running, then run 'multica login'.")
		return nil
	}

	// Authenticate.
	fmt.Fprintln(os.Stderr, "")
	if err := runLogin(cmd, args); err != nil {
		return err
	}

	fmt.Fprintln(os.Stderr, "\nStarting daemon...")
	if err := runDaemonBackground(cmd); err != nil {
		return fmt.Errorf("start daemon: %w", err)
	}
	fmt.Fprintln(os.Stderr, "\n✓ Setup complete! Your machine is now connected to Origin.")

	return nil
}

// serverHostIsLocal reports whether serverURL points at the same machine as
// the CLI (loopback literal or "localhost"). Used to decide whether to infer
// app_url from server_url or fall back to the local-dev default.
func serverHostIsLocal(serverURL string) bool {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return false
	}
	h := parsed.Hostname()
	if h == "localhost" {
		return true
	}
	if ip := net.ParseIP(h); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

func stringFlagOrDefault(cmd *cobra.Command, name, fallback string) string {
	if cmd.Flags().Lookup(name) == nil {
		return fallback
	}
	value, err := cmd.Flags().GetString(name)
	if err != nil {
		return fallback
	}
	return value
}

func intFlagOrDefault(cmd *cobra.Command, name string, fallback int) int {
	if cmd.Flags().Lookup(name) == nil {
		return fallback
	}
	value, err := cmd.Flags().GetInt(name)
	if err != nil {
		return fallback
	}
	return value
}

// promptAppURL asks the user for the frontend URL interactively. We can't
// derive it from a remote server_url — api.example.com ≠ app.example.com in
// most production setups — so guessing would just defer the failure to the
// browser login step. Returns an empty string if the user hits enter.
func promptAppURL(serverURL string) (string, error) {
	fmt.Fprintf(os.Stderr, "No --app-url provided, and --server-url (%s) is remote.\n", serverURL)
	fmt.Fprint(os.Stderr, "Enter the frontend app URL (e.g. https://app.internal.co): ")
	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')
	if err != nil && line == "" {
		return "", nil
	}
	return strings.TrimRight(strings.TrimSpace(line), "/"), nil
}

// probeServer checks whether a Multica backend is reachable at the given URL.
func probeServer(baseURL string) bool {
	url := strings.TrimRight(baseURL, "/") + "/health"
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}

	resp, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
