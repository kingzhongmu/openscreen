import { useId } from "react";
import {
	ARROW_ROTATIONS,
	ARROW_VIEWBOX_SIZE,
	computeArrowGeometry,
	getArrowTransform,
	normalizeFigureData,
} from "./arrowGeometry";
import type { ArrowDirection, FigureData } from "./types";

export interface ParametricArrowProps {
	direction: ArrowDirection;
	figureData: Partial<FigureData> & Pick<FigureData, "color">;
	className?: string;
	showShadow?: boolean;
}

export function ParametricArrow({
	direction,
	figureData,
	className,
	showShadow = true,
}: ParametricArrowProps) {
	const filterId = useId().replace(/:/g, "");
	const normalized = normalizeFigureData({ ...figureData, arrowDirection: direction });
	const geometry = computeArrowGeometry(normalized);
	const rotation = ARROW_ROTATIONS[direction];
	const headPointsAttr = geometry.headPoints.map((point) => `${point.x},${point.y}`).join(" ");

	return (
		<svg
			viewBox={`0 0 ${ARROW_VIEWBOX_SIZE} ${ARROW_VIEWBOX_SIZE}`}
			className={className}
			style={{ width: "100%", height: "100%" }}
		>
			{showShadow ? (
				<defs>
					<filter id={filterId}>
						<feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.3" />
					</filter>
				</defs>
			) : null}
			<g
				transform={getArrowTransform(geometry, rotation)}
				fill={normalized.color}
				filter={showShadow ? `url(#${filterId})` : undefined}
			>
				<rect
					x={geometry.shaft.x}
					y={geometry.shaft.y}
					width={geometry.shaft.width}
					height={geometry.shaft.height}
					rx={geometry.shaft.rx}
				/>
				<polygon points={headPointsAttr} />
			</g>
		</svg>
	);
}
