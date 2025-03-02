from pdfminer.high_level import extract_text
import os,sys,nltk,time,json
import tiktoken
import data_digestion

nltk.download("punkt")

current_file_directory = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(current_file_directory)
sys.path.append(current_file_directory)
from model import model #[gpt4o, gpt4vision, gpt4omini]
model_name = 'gpt4omini'

def extract_text_from_pdf(pdf_path):
    return extract_text(pdf_path)

def extract_sentences_from_pdf(text):
    # Split text into sentences using nltk
    sentences = nltk.sent_tokenize(text)
    # Alternatively, a regex-based approach
    # sentences = re.split(r'(?<=[.!?])\s+', text)
    return sentences

def write_list_to_file(filename, lines):
    with open(filename, "w", encoding="utf-8") as file:
        file.writelines(f"{line}\n" for line in lines)

def write_string_to_file(filename, text):
    with open(filename, "w", encoding="utf-8") as file:
        file.write(text)

def write_json_to_file(filename, data):
    with open(filename, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4, ensure_ascii=False)


def create_data_folder(path):
    data_path = path.replace('data','out').replace('.pdf','')
    os.makedirs(data_path, exist_ok=True)
    return data_path

def count_tokens(text, model="gpt-4o-mini"):
    encoder = tiktoken.encoding_for_model(model)  # Get the tokenizer for the specific model
    tokens = encoder.encode(text)  # Encode text into tokens
    return len(tokens)


def QA(question, context):
    prompt = (question[0] + question[1], context)
    response = model(model_name, prompt)
    if('|' in response):
        ans = [o.strip() for o in response.split('|')]
    else:
        ans = [response.strip()]
    input_tokens = count_tokens(question[0] + question[1] + context)
    output_tokens = count_tokens(response)
    return ans, input_tokens, output_tokens

def equal(res1, res2, metric = 'string'):
    res1 = sorted(res1)
    res2 = sorted(res2)
    #res1 and res2 are both list of strings 
    if(metric == 'string'):
        if(res1 != res2):
            return False
        res1_lower = []
        for r in res1:
            res1_lower.append(r)
        res2_lower = []
        for r in res2:
            res2_lower.append(r)
        for r in res1_lower:
            if r not in res2_lower:
                return False
        for r in res2_lower:
            if r not in res1_lower:
                return False
        return True
    else:
        if(len(res1) > 1 or len(res2) > 1):
            instruction = 'Given the following two lists of strings, determine whether they are equivalent. Equivalence is defined as being mostly semantically similar, even if they do not match exactly. For example, 2017/02 should be considered the same as 2017 Feb. If the two lists are equivalent, return True; otherwise, return False. List 1 is: ' + " ".join(res1) + ' List 2 is: ' + " ".join(res2) 
            response = model(model_name, (instruction, ''))
            if('true' in response.lower()):
                return True
            return False
        if(len(res1) == 1 and len(res2) == 1):
            instruction = 'Given the following two strings, '  + res1[0] + ', ' + res2[0] + '. Determine whether they are equivalent. Equivalence is defined as being mostly semantically similar, even if they do not match exactly. For example, 2017/02 should be considered the same as 2017 Feb. If the two strings are equivalent, return True; otherwise, return False.'
            response = model(model_name, (instruction, ''))
            if('true' in response.lower()):
                return True
            return False

def evaluate(answers, question, ids, sentences):
    context = ''
    #print(ids)
    for id in ids:
        context += sentences[id]
    #print(count_tokens(context))
    #print(context[:100])
    pred_ans, input_tokens, output_tokens = QA(question, context)
    #print(pred_ans)
    #print(answers)
    if(equal(pred_ans, answers)):
        #print('True')
        return True, input_tokens, output_tokens
    else:
        #print('False')
        return False, input_tokens, output_tokens

def vallina_LLM(question, context, title, path):
    answers, input_tokens, output_tokens = QA(question,context)
    print(answers)

    out = {}
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['path'] = path
    out['context_size'] = count_tokens(context)
    
    st = time.time()
    """
        Directly invoke LLM to return the provenance of ``answers'' to ``question'' in a given ``context''
    """
    instruction = 'Given the following question: ' + question[0] + ', the corresponding answers are: ' + ','.join(answers) +  '. Your task is to extract the set of sentences from the provided context that contribute to generating these answers. Identify the most relevant sentences that support the given answers. Make sure these sentences are raw sentences from the document. Do not add explanations. Do not create new words or sentences. The context is as follows: '
    prompt = (instruction, context)
    response = model(model_name, prompt)
    et = time.time()
    out['time'] = et-st
    out['provenance'] = response
    out['provenance_size'] = count_tokens(response)
    input_tokens = count_tokens(instruction + context)
    output_tokens = count_tokens(response)
    out['tokens'] = (input_tokens, output_tokens)
    write_json_to_file(path, out)
    return out

def sequential_greedy(question, context, title, path):
    answers, input_tokens, output_tokens = QA(question,context)
    print(answers)

    out = {}
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['path'] = path
    out['context_size'] = count_tokens(context)

    st = time.time()

    sentences = extract_sentences_from_pdf(context)
    print('Number of sentences:', len(sentences)) 
    removed_sentences = []
    input_tokens = 0
    output_tokens = 0
    for i in range(len(sentences)):
        print('Iterating sentence ',i, len(sentences))
        print(sentences[i])
        remaining_sentences_id = []
        for j in range(len(sentences)):
            if j in removed_sentences:
                continue
            if i == j:
                continue
            remaining_sentences_id.append(j)
        
        eval_result, input_token, output_token = evaluate(answers, question, remaining_sentences_id, sentences)
        input_tokens += input_token
        output_tokens += output_token
        if eval_result == True:#if removing this sentence does not change the final answers, then this sentence can be removed 
            removed_sentences.append(i) 
            print('Sentence ',i, ' is removed!')
    provenance = []
    provenance_id = []
    for i in range(len(sentences)):
        if i in removed_sentences:
            continue
        provenance_id.append(i)
        provenance.append(sentences[i])

    et = time.time()
    out['time'] = et-st
    out['provenance'] = provenance
    out['provenance_size'] = count_tokens(''.join(provenance))
    out['tokens'] = (input_tokens, output_tokens)
    out['provenance_ids'] = provenance_id 
    write_json_to_file(path, out)

    return out 

binary_out_ids = []
sum_input_tokens = 0
sum_output_tokens = 0

def divide_and_conquer(question, text, title, path):
    global binary_out_ids,sum_input_tokens,sum_output_tokens
    sum_input_tokens = 0
    sum_output_tokens = 0
    binary_out_ids = []
    answers, input_tokens, output_tokens = QA(question,text)
    print(answers)

    out = {}
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['path'] = path
    out['context_size'] = count_tokens(text)

    st = time.time()
    ids = []
    sentences = extract_sentences_from_pdf(text)
    for i in range(len(sentences)):
        ids.append(i)
    divide_and_conquer_core(answers, question, ids, sentences)
    binary_out_ids = list(set(binary_out_ids))
    binary_out_ids = sorted(binary_out_ids)
    print(binary_out_ids)
    et = time.time()
    out['time'] = et-st
    out['tokens'] = (input_tokens, output_tokens)
    out['provenance_ids'] = binary_out_ids 
    provenance = []
    for id in binary_out_ids:
        provenance.append(sentences[id])
    out['provenance'] = provenance
    out['provenance_size'] = count_tokens(''.join(provenance))
    write_json_to_file(path, out)


def divide_and_conquer_core(answers, question, ids, sentences):
    
    """
    Attempt to find a smaller subset of `sentences` that returns True for H,
    using a simple divide-and-conquer approach.
    
    Returns a (not guaranteed fully minimal) subset for which H is still True.
    """
    global binary_out_ids,sum_input_tokens,sum_output_tokens
    # If the entire set somehow doesn't trigger True, nothing to return
    eval_result, input_token, output_token = evaluate(answers, question, ids, sentences)
    # Start accumulating total token usage
    sum_input_tokens += input_token
    sum_output_tokens += output_token
    
    if not eval_result:
        return 
    else:
        # If there's only 0 or 1 sentence, we can't reduce further
        if len(ids) <= 1:
            binary_out_ids += ids
            return 
    
    # Split into two halves
    mid = len(ids) // 2
    left = ids[:mid]
    right = ids[mid:]

    divide_and_conquer_core(answers, question, left, sentences)
    divide_and_conquer_core(answers, question, right, sentences)
    
if __name__ == "__main__":
    data_path = parent_directory + '/data/papers.json'
    folder_path = parent_directory + '/out/papers'
    paper_objects = data_digestion.digest_paper_dataset(data_path)
    sample_paper_questions = data_digestion.sample_paper_questions()

    strategies = ['vallina_LLM','sequential_greedy','divide_and_conquer']
    strategy = 'sequential_greedy'
    doc_num = 4

    for q_id in range(len(sample_paper_questions)):
        q = sample_paper_questions[q_id]
        for p_id in range(len(paper_objects)):
            paper = paper_objects[p_id]
            path = folder_path + '/' + 'doc' + str(p_id) + '_q' + str(q_id) + '_' + strategy + '.json'
            if os.path.isfile(path):
                continue
            text = paper['text']
            title = paper['title']
            print(title)
            if strategy == 'vallina_LLM':
                vallina_LLM(q, text, title, path)
            elif strategy == 'sequential_greedy':
                sequential_greedy(q, text, title, path) 
            elif strategy == 'divide_and_conquer': 
                divide_and_conquer(q, text, title, path)
            if(p_id >= doc_num):
                break
        #break