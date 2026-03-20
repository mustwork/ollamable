import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: "class",
  },
  colorSchemes: {
    light: {
      palette: {
        primary: {
          main: "#2457d6",
          light: "#5b87f0",
          dark: "#183a8f",
        },
        secondary: {
          main: "#d96d43",
        },
        background: {
          default: "#f3f5f9",
          paper: "rgba(255, 255, 255, 0.78)",
        },
        divider: "rgba(16, 24, 40, 0.1)",
      },
    },
    dark: {
      palette: {
        primary: {
          main: "#8cc9ff",
          light: "#c0e2ff",
          dark: "#4d96d8",
        },
        secondary: {
          main: "#ff9671",
        },
        background: {
          default: "#0b0f17",
          paper: "rgba(18, 25, 39, 0.8)",
        },
        divider: "rgba(255,255,255,0.08)",
        action: {
          selected: "rgba(140, 201, 255, 0.12)",
          selectedOpacity: 0.12,
        },
      },
    },
  },
  typography: {
    fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
    h4: {
      fontFamily: '"Space Grotesk", "IBM Plex Sans", sans-serif',
      fontWeight: 700,
      letterSpacing: "-0.03em",
    },
    h5: {
      fontFamily: '"Space Grotesk", "IBM Plex Sans", sans-serif',
      fontWeight: 700,
    },
    h6: {
      fontFamily: '"Space Grotesk", "IBM Plex Sans", sans-serif',
      fontWeight: 700,
    },
    overline: {
      fontSize: "0.72rem",
      fontWeight: 700,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
    },
  },
  shape: {
    borderRadius: 18,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backdropFilter: "blur(20px)",
          backgroundImage: "none",
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: "var(--mui-palette-background-paper)",
          borderLeft: "1px solid var(--mui-palette-divider)",
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
    },
    MuiChip: {
      styleOverrides: {
        outlined: {
          borderColor: "var(--mui-palette-divider)",
        },
      },
    },
  },
});

export default theme;
