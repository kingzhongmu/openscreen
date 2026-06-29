import { ChevronDown, Image as ImageIcon, MessageSquarePlus, Mic, Type } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { BLUR_REGIONS_ENABLED } from "./featureFlags";
import type { AnnotationType } from "./types";

export interface PositionAnnotationAddRequest {
	type: AnnotationType;
}

interface AddPositionAnnotationMenuProps {
	disabled?: boolean;
	onAdd: (request: PositionAnnotationAddRequest) => void;
	onImportAudio?: () => void;
	/** Compact icon-only trigger (timeline toolbar). */
	variant?: "default" | "icon";
	className?: string;
}

function ArrowMenuIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
		>
			<path d="M4 12h16m0 0l-6-6m6 6l-6 6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function BlurMenuIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
		>
			<circle cx="8" cy="12" r="3" />
			<circle cx="16" cy="12" r="3" />
			<path d="M6 6h12M6 18h12" />
		</svg>
	);
}

export function AddPositionAnnotationMenu({
	disabled = false,
	onAdd,
	onImportAudio,
	variant = "default",
	className,
}: AddPositionAnnotationMenuProps) {
	const t = useScopedT("editor");

	const items: Array<{ type: AnnotationType; label: string; icon: ReactNode }> = [
		{ type: "text", label: t("positionAnnotation.typeText"), icon: <Type className="w-4 h-4" /> },
		{
			type: "figure",
			label: t("positionAnnotation.typeArrow"),
			icon: <ArrowMenuIcon className="w-4 h-4" />,
		},
		{
			type: "image",
			label: t("positionAnnotation.typeImage"),
			icon: <ImageIcon className="w-4 h-4" />,
		},
	];

	if (BLUR_REGIONS_ENABLED) {
		items.push({
			type: "blur",
			label: t("positionAnnotation.typeBlur"),
			icon: <BlurMenuIcon className="w-4 h-4" />,
		});
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild disabled={disabled}>
				{variant === "icon" ? (
					<Button
						variant="ghost"
						size="icon"
						disabled={disabled}
						className={cn(
							"h-7 w-7 rounded-lg text-slate-400 hover:text-[#B4A046] hover:bg-[#B4A046]/10 transition-all",
							className,
						)}
						title={t("positionAnnotation.addButton")}
					>
						<MessageSquarePlus className="w-4 h-4" />
					</Button>
				) : (
					<Button
						variant="outline"
						size="sm"
						disabled={disabled}
						className={cn(
							"h-8 shrink-0 gap-1.5 rounded-full border-white/10 bg-black/60 px-3 text-[11px] font-medium text-slate-200 backdrop-blur-md hover:bg-black/70 hover:text-white",
							className,
						)}
					>
						<MessageSquarePlus className="w-3.5 h-3.5 text-[#B4A046]" />
						<span>{t("positionAnnotation.addButton")}</span>
						<ChevronDown className="w-3 h-3 text-slate-500" />
					</Button>
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="bg-[#1a1a1a] border-white/10 min-w-[180px]">
				{items.map((item) => (
					<DropdownMenuItem
						key={item.type}
						onClick={() => onAdd({ type: item.type })}
						className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer gap-2"
					>
						{item.icon}
						<span>{item.label}</span>
					</DropdownMenuItem>
				))}
				{onImportAudio && (
					<DropdownMenuItem
						onClick={onImportAudio}
						className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer gap-2"
					>
						<Mic className="w-4 h-4" />
						<span>{t("positionAnnotation.typeAudio")}</span>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
