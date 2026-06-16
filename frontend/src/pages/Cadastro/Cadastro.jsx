import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import styles from "./Cadastro.module.css";

function Cadastro() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    nomeResponsavel: "",
    email: "",
    senha: "",
    razaoSocial: "",
    nomeFantasia: "",
    cnpj: "",
    telefone: "",
    whatsapp: "",
  });

  const alterar = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  const cadastrar = async (e) => {
    e.preventDefault();

    try {
      await api.post("/auth/cadastro", form);

      alert("Cadastro enviado com sucesso. Aguarde aprovação.");
      navigate("/login");
    } catch (error) {
      alert(error.response?.data?.message || "Erro ao cadastrar");
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1>AtualPet</h1>
        <p>Solicite seu acesso ao catálogo.</p>

        <form onSubmit={cadastrar}>
          <input name="nomeResponsavel" placeholder="Nome do responsável" value={form.nomeResponsavel} onChange={alterar} required />
          <input name="email" type="email" placeholder="E-mail" value={form.email} onChange={alterar} required />
          <input name="senha" type="password" placeholder="Senha" value={form.senha} onChange={alterar} required />
          <input name="razaoSocial" placeholder="Razão social" value={form.razaoSocial} onChange={alterar} />
          <input name="nomeFantasia" placeholder="Nome fantasia" value={form.nomeFantasia} onChange={alterar} />
          <input name="cnpj" placeholder="CNPJ" value={form.cnpj} onChange={alterar} />
          <input name="telefone" placeholder="Telefone" value={form.telefone} onChange={alterar} />
          <input name="whatsapp" placeholder="WhatsApp" value={form.whatsapp} onChange={alterar} />

          <button type="submit">Enviar cadastro</button>
        </form>

        <Link to="/login">Já tenho acesso</Link>
      </div>
    </div>
  );
}

export default Cadastro;