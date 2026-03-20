"use client";

import { useEffect, useState } from "react";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import DesktopWindowsOutlinedIcon from "@mui/icons-material/DesktopWindowsOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import { Stack, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";

type ColorMode = "light" | "dark" | "system";

export function ColorModeToggle() {
  const { mode, setMode } = useColorScheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const value: ColorMode = mounted && mode ? mode : "system";

  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_, nextMode: ColorMode | null) => {
        if (nextMode) {
          setMode(nextMode);
        }
      }}
      aria-label="Color mode"
      sx={{
        bgcolor: "background.paper",
        borderRadius: 999,
        "& .MuiToggleButton-root": {
          border: 0,
          px: 1.25,
          color: "text.secondary",
          textTransform: "none",
        },
        "& .Mui-selected": {
          bgcolor: "action.selected",
          color: "text.primary",
        },
      }}
    >
      <ToggleButton value="light" aria-label="Light mode">
        <Tooltip title="Light mode">
          <Stack direction="row" alignItems="center">
            <LightModeOutlinedIcon fontSize="small" />
          </Stack>
        </Tooltip>
      </ToggleButton>
      <ToggleButton value="system" aria-label="System mode">
        <Tooltip title="System mode">
          <Stack direction="row" alignItems="center">
            <DesktopWindowsOutlinedIcon fontSize="small" />
          </Stack>
        </Tooltip>
      </ToggleButton>
      <ToggleButton value="dark" aria-label="Dark mode">
        <Tooltip title="Dark mode">
          <Stack direction="row" alignItems="center">
            <DarkModeOutlinedIcon fontSize="small" />
          </Stack>
        </Tooltip>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
