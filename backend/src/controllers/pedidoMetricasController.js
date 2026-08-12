import { gerarPdfMetricasPedidos } from "../services/pdfMetricasPedidosService.js";
import {
  obterMetricasPedidos,
  PedidoMetricasQueryError,
} from "../services/pedidoMetricasService.js";
import { parsePedidoMetricasQuery } from "../utils/pedidoMetricas.js";
import { sendServerError } from "../utils/validation.js";

const parseFilters = (req, res) => {
  const parsed = parsePedidoMetricasQuery(req.query);
  if (!parsed.valid) {
    res.status(400).json({
      message: "Filtros de métricas inválidos",
      errors: parsed.errors,
    });
    return null;
  }
  return parsed.data;
};

const handleError = (error, res) => {
  if (error instanceof PedidoMetricasQueryError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  return sendServerError(res);
};

export const listarMetricasPedidosAdmin = async (req, res) => {
  const filters = parseFilters(req, res);
  if (!filters) return;
  try {
    const metrics = await obterMetricasPedidos(filters);
    return res.status(200).json(metrics);
  } catch (error) {
    return handleError(error, res);
  }
};

export const exportarMetricasPedidosPdfAdmin = async (req, res) => {
  const filters = parseFilters(req, res);
  if (!filters) return;
  try {
    const metrics = await obterMetricasPedidos(filters);
    return gerarPdfMetricasPedidos(metrics, res);
  } catch (error) {
    return handleError(error, res);
  }
};

