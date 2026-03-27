"use client";

import { useEffect, useState } from "react";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import DesktopWindowsOutlinedIcon from "@mui/icons-material/DesktopWindowsOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import { IconButton, Tooltip } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";

type ColorMode = "light" | "dark" | "system";

const MODE_CYCLE: ColorMode[] = ["light", "system", "dark"];
const MODE_ICONS: Record<ColorMode, React.ReactNode> = {
  light: <LightModeOutlinedIcon fontSize="small" />,
  system: <DesktopWindowsOutlinedIcon fontSize="small" />,
  dark: <DarkModeOutlinedIcon fontSize="small" />,
};
const MODE_LABELS: Record<ColorMode, string> = {
  light: "Light mode",
  system: "System mode",
  dark: "Dark mode",
};

export function ColorModeToggle() {
  const { mode, setMode } = useColorScheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const value: ColorMode = mounted && mode ? mode : "system";

  const handleClick = () => {
    const currentIndex = MODE_CYCLE.indexOf(value);
    const nextMode = MODE_CYCLE[(currentIndex + 1) % MODE_CYCLE.length];
    setMode(nextMode);
  };

  return (
    <Tooltip title={MODE_LABELS[value]}>
      <IconButton
        size="small"
        onClick={handleClick}
        aria-label={MODE_LABELS[value]}
        sx={{ color: "text.secondary" }}
      >
        {MODE_ICONS[value]}
      </IconButton>
    </Tooltip>
  );
}
